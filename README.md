# Org Chart Builder

Turn a CSV of people into a neatly laid-out org chart, then finish it in draw.io.

Open `index.html` in a browser. No install, no server, no dependencies.

## CSV format

One row per person, with a column pointing to their manager (by ID or by name):

```csv
id,name,title,manager_id,department
1,Maria Jensen,CEO,,Executive
2,Tom Becker,CTO,1,Engineering
```

Columns are auto-detected from common header names and can be changed in the panel.
Any extra columns can be shown on the cards or used for colouring.

## Features

- **Layout presets**: Classic, Compact (small teams in two columns), Team lists, Sideways
- Stacking of teams with no sub-reports, spacing and card size sliders, levels shown
- Focus on a branch by clicking a manager (click them again to go up a level)
- Colour by any column (department, location…), three card styles
- **Export**: open straight in draw.io, or download `.drawio`, SVG or PNG.
  In draw.io every card keeps its CSV row as shape data (Edit Data), and connectors
  stay attached when cards are moved.

## Privacy & storage

The tool has no server, analytics or third-party scripts. The CSV is read and
processed entirely in your browser and is never uploaded.

What is kept, and where:

- **Settings** (layout, sizes, colours) are remembered in the browser.
- **Column choices** are remembered per CSV shape (set of headers), together with
  the ID of the person last focused on. The 20 most recent shapes are kept.
- **The CSV itself** is only kept if you tick *Remember this CSV in this browser*,
  and then unencrypted in browser storage: anyone using the same browser profile
  can read it. Otherwise it is gone on refresh. Unticking it deletes the stored copy.
- **Downloads** (`.drawio`, SVG, PNG) are ordinary files on your disk.

**Open in draw.io and confidential data.** The chart, with everything shown on the
cards, travels inside the link to app.diagrams.net. The `#…` part of a link is not
sent to the server, but the full link is saved in your **browser history**, which
is synced to the cloud if browser sync is on, and draw.io may keep a draft in its
own browser storage. The tool warns about this before opening. For confidential
data, use the `.drawio` download and the draw.io desktop app instead.

## Files

- `js/csv.js`: CSV parser
- `js/layout.js`: tree building and layout (pure, no DOM)
- `js/render.js`: colours and SVG rendering
- `js/drawio.js`: draw.io export
- `js/app.js`: UI wiring
- `js/sample.js`: embedded copy of `sample.csv`
