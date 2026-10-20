# Bible translations that come with Lumen

Each file is one translation's 66 books as gzipped JSON, made from the source below with
`node scripts/bundle-bible.js <source> bibles/<id>.json.gz`. All three are in the public domain (in the United
Kingdom the King James Version is under Crown letters patent instead).

| File | Translation | Source |
| --- | --- | --- |
| `kjv.json.gz` | King James Version (1769) | `eng-kjv.osis.xml` from [seven1m/open-bibles](https://github.com/seven1m/open-bibles), from eBible.org |
| `web.json.gz` | World English Bible | `eng-web.usfx.xml` from [seven1m/open-bibles](https://github.com/seven1m/open-bibles), from eBible.org |
| `bsb.json.gz` | Berean Standard Bible | `eng-bsb.usfx.xml` from [seven1m/open-bibles](https://github.com/seven1m/open-bibles); dedicated to the public domain by its translators in 2023 |

To update one, make its file again and raise its `version` in `server/bible/bibles.js`, so data folders that
already have the older copy replace it.
