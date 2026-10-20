# pdf.js

[pdf.js](https://mozilla.github.io/pdf.js/) 6.4.299 from the `pdfjs-dist` package (`legacy/build/pdf.min.mjs` and
`legacy/build/pdf.worker.min.mjs`: the legacy build, so it also runs in browsers a few versions old), under the Apache License 2.0 in `LICENSE`. The console uses it to turn each page of an
imported PDF into a picture (`console/powerpoint.js`), so PDFs need nothing installed.

To update, copy the same two files and `LICENSE` from a newer `pdfjs-dist` and change the version here.
