# Exports each slide of a presentation (or page of a PDF) as a PNG, through LibreOffice.
# Run with LibreOffice's own Python (or a Python that has its uno module):
#   python slides-uno.py <soffice> <profile dir> <file> <out dir> <width>
# Prints the slide count when done. Exits with 3 if this Python has no uno module, so the caller can try
# another way.
import os
import subprocess
import sys
import time

try:
    import uno
    from com.sun.star.beans import PropertyValue
    from com.sun.star.connection import NoConnectException
except ImportError:
    sys.exit(3)


def prop(name, value):
    p = PropertyValue()
    p.Name, p.Value = name, value
    return p


def main(soffice, profile, src, out, width):
    width = int(width)
    pipe = 'lumen-slides-%d' % os.getpid()
    # A profile of its own, so a LibreOffice the user has open is left alone (and doesn't take the job over).
    office = subprocess.Popen([soffice, '-env:UserInstallation=' + uno.systemPathToFileUrl(profile),
                               '--headless', '--invisible', '--nologo', '--norestore', '--nodefault',
                               '--nolockcheck', '--accept=pipe,name=%s;urp;' % pipe],
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        ctx = None
        for _ in range(240):  # the first start, which sets up the profile, can take a while
            try:
                ctx = resolver.resolve('uno:pipe,name=%s;urp;StarOffice.ComponentContext' % pipe)
                break
            except NoConnectException:
                if office.poll():  # failed (on some systems the launcher hands over and exits 0)
                    raise RuntimeError('LibreOffice stopped while starting')
                time.sleep(0.5)
        if ctx is None:
            raise RuntimeError('LibreOffice did not start')
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
        # Never run macros a file carries.
        doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(src)), '_blank', 0,
                                           (prop('Hidden', True), prop('ReadOnly', True), prop('MacroExecutionMode', 0)))
        if doc is None or not any(doc.supportsService(s) for s in (
                'com.sun.star.presentation.PresentationDocument', 'com.sun.star.drawing.DrawingDocument')):
            raise RuntimeError('not a presentation')
        pages = doc.getDrawPages()
        export = smgr.createInstanceWithContext('com.sun.star.drawing.GraphicExportFilter', ctx)
        n = 0
        for i in range(pages.getCount()):
            page = pages.getByIndex(i)
            # A hidden slide isn't part of the show.
            if page.getPropertySetInfo().hasPropertyByName('Visible') and not page.Visible:
                continue
            height = max(1, round(width * page.Height / page.Width))
            n += 1
            data = uno.Any('[]com.sun.star.beans.PropertyValue',
                           (prop('PixelWidth', width), prop('PixelHeight', height)))
            export.setSourceDocument(page)
            uno.invoke(export, 'filter', ((prop('URL', uno.systemPathToFileUrl(os.path.join(os.path.abspath(out), '%04d.png' % n))),
                                           prop('MediaType', 'image/png'), prop('FilterData', data)),))
        doc.close(True)
        print(n)
    finally:
        try:
            desktop.terminate()
        except Exception:
            pass
        try:
            office.wait(20)
        except subprocess.TimeoutExpired:
            office.kill()


if __name__ == '__main__':
    try:
        main(*sys.argv[1:6])
    except Exception as e:
        sys.stderr.write(str(getattr(e, 'Message', '') or e) + '\n')
        sys.exit(1)
