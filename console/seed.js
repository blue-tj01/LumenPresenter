// @ts-check
// What a new library starts with: public-domain hymns, background colours and templates.
import { BUILTIN_THEMES_V1, DEFAULT_THEME_V1, migrateLibrary } from './format.js';
import { makePres, uid } from './slides.js';

// ---------- seed data (public-domain hymns) ----------
const SEED_SONGS = [
  [
    'Amazing Grace',
    `[Verse 1]
Amazing grace! How sweet the sound
That saved a wretch like me!

I once was lost, but now am found;
Was blind, but now I see.

[Verse 2]
'Twas grace that taught my heart to fear,
And grace my fears relieved;

How precious did that grace appear
The hour I first believed.

[Verse 3]
Through many dangers, toils and snares,
I have already come;

'Tis grace hath brought me safe thus far,
And grace will lead me home.

[Verse 4]
When we've been there ten thousand years,
Bright shining as the sun,

We've no less days to sing God's praise
Than when we'd first begun.`,
  ],
  [
    'Holy, Holy, Holy',
    `[Verse 1]
Holy, holy, holy! Lord God Almighty!
Early in the morning our song shall rise to Thee;

Holy, holy, holy, merciful and mighty!
God in three Persons, blessed Trinity!

[Verse 2]
Holy, holy, holy! All the saints adore Thee,
Casting down their golden crowns around the glassy sea;

Cherubim and seraphim falling down before Thee,
Who wert, and art, and evermore shalt be.

[Ending]
Holy, holy, holy! Lord God Almighty!
All Thy works shall praise Thy name, in earth, and sky, and sea;

Holy, holy, holy; merciful and mighty!
God in three Persons, blessed Trinity!`,
  ],
  [
    'Be Thou My Vision',
    `[Verse 1]
Be Thou my Vision, O Lord of my heart;
Naught be all else to me, save that Thou art.

Thou my best Thought, by day or by night,
Waking or sleeping, Thy presence my light.

[Verse 2]
Be Thou my Wisdom, and Thou my true Word;
I ever with Thee and Thou with me, Lord;

Thou my great Father, I Thy true son;
Thou in me dwelling, and I with Thee one.

[Verse 3]
High King of Heaven, my victory won,
May I reach Heaven's joys, O bright Heaven's Sun!

Heart of my own heart, whatever befall,
Still be my Vision, O Ruler of all.`,
  ],
  [
    'Doxology',
    `[Chorus]
Praise God, from whom all blessings flow;
Praise Him, all creatures here below;

Praise Him above, ye heavenly host;
Praise Father, Son, and Holy Ghost.

[Tag]
Amen.`,
  ],
  [
    'Welcome & Announcements',
    `@bg: linear-gradient(135deg,#1e3c72,#2a5298)
[Intro]
Welcome!
We're glad you're here.

[Announcements]
Coffee & fellowship
after the service in the hall

Youth night
Friday · 7 PM

[Ending]
Have a great week!`,
  ],
];

const BUILTIN_MEDIA = [
  { name: 'Black', type: 'color', src: '#000000' },
  { name: 'Midnight', type: 'gradient', src: 'linear-gradient(160deg,#0f2027,#203a43,#2c5364)' },
  { name: 'Sunrise', type: 'gradient', src: 'linear-gradient(135deg,#f7971e,#b2195e 60%,#3a1c71)' },
  { name: 'Deep Sea', type: 'gradient', src: 'radial-gradient(circle at 30% 20%,#1a6dff,#0b1a3d 70%)' },
  { name: 'Forest', type: 'gradient', src: 'linear-gradient(135deg,#134e5e,#71b280)' },
  { name: 'Aurora (motion)', type: 'motion', src: 'linear-gradient(-45deg,#0b3866,#2e1a5e,#0d6e6e,#1b2a6b)' },
  { name: 'Ember (motion)', type: 'motion', src: 'linear-gradient(-45deg,#3a0a0a,#8a2b06,#3d0f2e,#5c1a00)' },
  { name: 'Lavender (motion)', type: 'motion', src: 'linear-gradient(-45deg,#41295a,#2f0743,#5b3a8a,#1d1a4a)' },
];

// Who wrote the hymns, shown with their credits on each one's last slide.
const SEED_CREDITS = {
  'Amazing Grace': { author: 'John Newton', copyright: 'Public Domain', ccli: '22025' },
  'Holy, Holy, Holy': { author: 'Reginald Heber, John Bacchus Dykes', copyright: 'Public Domain' },
  'Be Thou My Vision': { author: 'Traditional Irish, tr. Mary Byrne and Eleanor Hull', copyright: 'Public Domain' },
  Doxology: { author: 'Thomas Ken', copyright: 'Public Domain' },
};

/** The templates a library starts with: Classic, Lower third, Scripture and Big & bold. Fixed ids, so every console
 * agrees on them before the library is first saved. */
export const BUILTIN_TEMPLATES = () => migrateLibrary({ presentations: [] }).templates;

export function seed() {
  const pres = SEED_SONGS.map(([n, t]) =>
    SEED_CREDITS[n] ? { ...makePres(n, t), meta: { ...SEED_CREDITS[n] } } : makePres(n, t),
  );
  return migrateLibrary({
    presentations: pres,
    playlist: [pres[4].id, pres[0].id, pres[2].id, pres[3].id],
    media: BUILTIN_MEDIA.map(m => ({ id: uid(), builtin: true, ...m })),
    theme: { ...DEFAULT_THEME_V1 },
    themes: BUILTIN_THEMES_V1.map(t => ({ ...t })),
    messages: [
      'Welcome! Please silence your phones.',
      'Nursery parents: please come to the nursery.',
      'The parking lot lights are on — car ABC-123.',
    ],
    logoText: 'WELCOME',
  });
}
