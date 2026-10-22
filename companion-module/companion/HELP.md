## Lumen Presenter

Step through a service in [Lumen Presenter](https://github.com/blue-tj01/LumenPresenter) from a Stream Deck or any other Companion surface, and show what is on screen on the buttons.

### Setting up

Open the **Control** tab in the Lumen console. It shows the address, port and (in network mode) the access token to enter here.

- **Companion on the same computer as Lumen:** address `127.0.0.1`, port `8642`, no token.
- **Companion on another computer:** turn on network mode in Lumen's **Network** tab, then enter that computer's address and the access token. If you make a new token in Lumen, enter the new one here.

Lumen must have its console open, as the console is what moves the slides.

### Actions

- Next and previous slide, and next and previous presentation in the playlist
- Go to a presentation by its place in the playlist, or to a slide of the live presentation (both counted from 1)
- Clear everything, the slide, the background or the message, and turn the logo on or off
- Play, pause or restart the video, and pause or resume auto-advance
- Start, pause and reset the countdown timer

### Feedbacks

**What is on screen** lights a button while a slide, background, message or the logo is showing, while the screen is clear, while a video plays, while the timer runs, or once it has run out.

### Variables

`presentation`, `group`, `slide_number`, `slide_text`, `next_text`, `message`, `timer` and `clock`.

### Presets

Ready-made buttons for slides, clearing, media and the timer are under **Presets**.
