// @ts-check
// The books of the Bible: their OSIS and USFM ids, English names, and the abbreviations a typed reference may use.
// A book's number is its place in this list (Genesis is 1), which is also how Zefania files number the first 66.
'use strict';

/** [OSIS id, USFM id, name, ...other names and abbreviations]. */
const BOOKS = [
  ['Gen', 'GEN', 'Genesis', 'Ge', 'Gn'],
  ['Exod', 'EXO', 'Exodus', 'Ex', 'Exo'],
  ['Lev', 'LEV', 'Leviticus', 'Le', 'Lv'],
  ['Num', 'NUM', 'Numbers', 'Nu', 'Nm', 'Nb'],
  ['Deut', 'DEU', 'Deuteronomy', 'Dt', 'De'],
  ['Josh', 'JOS', 'Joshua', 'Jos', 'Jsh'],
  ['Judg', 'JDG', 'Judges', 'Jdg', 'Jg', 'Jdgs'],
  ['Ruth', 'RUT', 'Ruth', 'Rth', 'Ru'],
  ['1Sam', '1SA', '1 Samuel', '1 Sa', '1 Sm', '1 Kingdoms'],
  ['2Sam', '2SA', '2 Samuel', '2 Sa', '2 Sm', '2 Kingdoms'],
  ['1Kgs', '1KI', '1 Kings', '1 Ki', '1 Kg', '1 Kin', '3 Kingdoms'],
  ['2Kgs', '2KI', '2 Kings', '2 Ki', '2 Kg', '2 Kin', '4 Kingdoms'],
  ['1Chr', '1CH', '1 Chronicles', '1 Ch', '1 Chron'],
  ['2Chr', '2CH', '2 Chronicles', '2 Ch', '2 Chron'],
  ['Ezra', 'EZR', 'Ezra', 'Ezr'],
  ['Neh', 'NEH', 'Nehemiah', 'Ne'],
  ['Esth', 'EST', 'Esther', 'Es', 'Est'],
  ['Job', 'JOB', 'Job', 'Jb'],
  ['Ps', 'PSA', 'Psalms', 'Psalm', 'Psa', 'Pss', 'Psm', 'Pslm'],
  ['Prov', 'PRO', 'Proverbs', 'Pr', 'Prv'],
  ['Eccl', 'ECC', 'Ecclesiastes', 'Ec', 'Ecc', 'Eccles', 'Qoheleth'],
  ['Song', 'SNG', 'Song of Solomon', 'Song of Songs', 'Song', 'SS', 'SOS', 'Canticles', 'Cant'],
  ['Isa', 'ISA', 'Isaiah', 'Is'],
  ['Jer', 'JER', 'Jeremiah', 'Je', 'Jr'],
  ['Lam', 'LAM', 'Lamentations', 'La'],
  ['Ezek', 'EZK', 'Ezekiel', 'Eze', 'Ezk'],
  ['Dan', 'DAN', 'Daniel', 'Da', 'Dn'],
  ['Hos', 'HOS', 'Hosea', 'Ho'],
  ['Joel', 'JOL', 'Joel', 'Jl'],
  ['Amos', 'AMO', 'Amos', 'Am'],
  ['Obad', 'OBA', 'Obadiah', 'Ob'],
  ['Jonah', 'JON', 'Jonah', 'Jnh', 'Jon'],
  ['Mic', 'MIC', 'Micah', 'Mc'],
  ['Nah', 'NAM', 'Nahum', 'Na'],
  ['Hab', 'HAB', 'Habakkuk', 'Hb'],
  ['Zeph', 'ZEP', 'Zephaniah', 'Zep', 'Zp'],
  ['Hag', 'HAG', 'Haggai', 'Hg'],
  ['Zech', 'ZEC', 'Zechariah', 'Zec', 'Zc'],
  ['Mal', 'MAL', 'Malachi', 'Ml'],
  ['Matt', 'MAT', 'Matthew', 'Mt', 'Mat'],
  ['Mark', 'MRK', 'Mark', 'Mk', 'Mr', 'Mrk'],
  ['Luke', 'LUK', 'Luke', 'Lk', 'Lu'],
  ['John', 'JHN', 'John', 'Jn', 'Jhn', 'Joh'],
  ['Acts', 'ACT', 'Acts', 'Ac'],
  ['Rom', 'ROM', 'Romans', 'Ro', 'Rm'],
  ['1Cor', '1CO', '1 Corinthians', '1 Co'],
  ['2Cor', '2CO', '2 Corinthians', '2 Co'],
  ['Gal', 'GAL', 'Galatians', 'Ga'],
  ['Eph', 'EPH', 'Ephesians', 'Ephes'],
  ['Phil', 'PHP', 'Philippians', 'Php', 'Pp'],
  ['Col', 'COL', 'Colossians', 'Co'],
  ['1Thess', '1TH', '1 Thessalonians', '1 Th', '1 Thes'],
  ['2Thess', '2TH', '2 Thessalonians', '2 Th', '2 Thes'],
  ['1Tim', '1TI', '1 Timothy', '1 Ti', '1 Tm'],
  ['2Tim', '2TI', '2 Timothy', '2 Ti', '2 Tm'],
  ['Titus', 'TIT', 'Titus', 'Tit', 'Ti'],
  ['Phlm', 'PHM', 'Philemon', 'Philem', 'Phm'],
  ['Heb', 'HEB', 'Hebrews'],
  ['Jas', 'JAS', 'James', 'Jm', 'Jam'],
  ['1Pet', '1PE', '1 Peter', '1 Pe', '1 Pt'],
  ['2Pet', '2PE', '2 Peter', '2 Pe', '2 Pt'],
  ['1John', '1JN', '1 John', '1 Jn', '1 Jo', '1 Jhn'],
  ['2John', '2JN', '2 John', '2 Jn', '2 Jo', '2 Jhn'],
  ['3John', '3JN', '3 John', '3 Jn', '3 Jo', '3 Jhn'],
  ['Jude', 'JUD', 'Jude', 'Jud', 'Jd'],
  ['Rev', 'REV', 'Revelation', 'Re', 'Rv', 'Apocalypse', 'Revelation of John', 'Revelations'],
  // Deuterocanonical books, for the translations that have them.
  ['Tob', 'TOB', 'Tobit', 'Tb'],
  ['Jdt', 'JDT', 'Judith', 'Jdth'],
  ['AddEsth', 'ESG', 'Esther (Greek)', 'Additions to Esther', 'Add Esth', 'EsthGr'],
  ['Wis', 'WIS', 'Wisdom of Solomon', 'Wisdom', 'Ws'],
  ['Sir', 'SIR', 'Sirach', 'Ecclesiasticus', 'Ecclus'],
  ['Bar', 'BAR', 'Baruch'],
  ['EpJer', 'LJE', 'Letter of Jeremiah', 'Epistle of Jeremiah'],
  ['PrAzar', 'S3Y', 'Prayer of Azariah', 'Song of the Three Young Men', 'Song of Three Youths'],
  ['Sus', 'SUS', 'Susanna'],
  ['Bel', 'BEL', 'Bel and the Dragon'],
  ['1Macc', '1MA', '1 Maccabees', '1 Mac', '1 Ma'],
  ['2Macc', '2MA', '2 Maccabees', '2 Mac', '2 Ma'],
  ['3Macc', '3MA', '3 Maccabees', '3 Mac'],
  ['4Macc', '4MA', '4 Maccabees', '4 Mac'],
  ['1Esd', '1ES', '1 Esdras', '1 Esd'],
  ['2Esd', '2ES', '2 Esdras', '2 Esd'],
  ['PrMan', 'MAN', 'Prayer of Manasseh', 'Prayer of Manasses'],
  ['Ps151', 'PS2', 'Psalm 151'],
  ['DanGr', 'DAG', 'Daniel (Greek)'],
];

/** Book numbers above this are other books a file brought, in the order it had them. */
const KNOWN = BOOKS.length;

/** Books of one chapter, where "Jude 3" means verse 3. */
const ONE_CHAPTER = new Set(['Obad', 'Phlm', '2John', '3John', 'Jude']);

/** A name or abbreviation as references are matched: lower case, no spaces or full stops, and 1/I/First alike. */
function key(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(?:iii|3rd|third)\b\.?\s*/, '3')
    .replace(/^\s*(?:ii|2nd|second)\b\.?\s*/, '2')
    .replace(/^\s*(?:i|1st|first)\b\.?\s*(?=\S)/, '1')
    .replace(/[\s.]+/g, '');
}

const byOsis = new Map(BOOKS.map((b, i) => [b[0].toLowerCase(), i + 1]));
byOsis.set('esthgr', byOsis.get('addesth'));
const byUsfm = new Map(BOOKS.map((b, i) => [b[1], i + 1]));
const byName = new Map();
BOOKS.forEach((b, i) =>
  [b[0], ...b.slice(2)].forEach(n => {
    if (!byName.has(key(n))) byName.set(key(n), i + 1);
  }),
);

const book = n =>
  BOOKS[n - 1] ? { number: n, osis: BOOKS[n - 1][0], usfm: BOOKS[n - 1][1], name: BOOKS[n - 1][2] } : null;
const fromOsis = id => byOsis.get(String(id).toLowerCase()) || 0;
const fromUsfm = id => byUsfm.get(String(id).toUpperCase()) || 0;
const fromName = name => byName.get(key(name)) || 0;

module.exports = { BOOKS, KNOWN, ONE_CHAPTER, key, book, fromOsis, fromUsfm, fromName };
