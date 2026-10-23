# Changelog

What changed in each release of Lumen Presenter, newest first. Changes waiting for the next release are under
**Unreleased**; when a version is tagged, they move under its number. Earlier releases are described on the
[Releases page](https://github.com/blue-tj01/LumenPresenter/releases).

## Unreleased

### Changed
- Saving sends only the songs, services and settings that changed, so a change takes the same time in a library of
  any size (editing one song in a 10,000-song library went from about 0.4 s to about 12 ms on the server, and from
  a 17 MB upload to the song alone).
- Two consoles changing different songs at the same time no longer lose one of the changes. When both change the
  same song, the first saved is kept and the other console says which song it was.
- Other consoles receive just the change, instead of loading the whole library again.
- Import, Export and Reset move from the top bar into a **Library…** dialog. Starting over needs START OVER typed,
  and importing asks first.
- The browser's own copy of the library moves from localStorage (about 5 MB) to IndexedDB.

### Added
- Undo and redo for the library (Ctrl+Z, Ctrl+Shift+Z, and ↶ ↷ in the top bar): editing or deleting a song, themes,
  the playlist, services, messages and the rest. Changes made within a moment of each other are one step.
- Backups can be listed and restored from the Library dialog. A backup is made before every import, restore or
  start over, and the last backup of each day is kept for 30 days on top of the latest 50.
- Every question is asked in Lumen's own dialog rather than the browser's `confirm()`, with Cancel picked for
  anything that can't be taken back, and keys kept from the slides behind it.
- An icon for the pages in browser tabs.

### Development
- Browser tests of the console (Playwright), ESLint, and type checking of files marked `// @ts-check`, all run in CI.
