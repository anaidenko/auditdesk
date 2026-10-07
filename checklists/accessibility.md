# Accessibility

When the repository has a user interface. From the code alone: templates, components and styles
are read and nothing is rendered, so no contrast is measured and no screen reader runs. Judge
what a keyboard or screen-reader user meets against WCAG 2.2 level AA, and cite the component.
For a mobile app (React Native, Ionic), read the platform's equivalents (`accessibilityLabel`,
`accessibilityRole`, `aria-label` on Ionic components).

Severity: high when a core task (signing in, searching, buying, sending the main form) cannot be
completed with a keyboard or a screen reader. Medium when it can only with real difficulty
(fields without labels, focus lost after an action, errors never announced). Low for barriers
outside the core tasks and for hygiene.

## ACC-01 Text alternatives

Images without `alt`, or with an `alt` that repeats a file name; decorative images not marked
`alt=""`; buttons and links that hold only an icon and have no accessible name; SVG icons with
neither a title nor `aria-hidden`; charts with no text equivalent.

## ACC-02 Forms

Inputs labelled only by a placeholder; labels not tied to their inputs (`htmlFor` and `id`);
required fields and expected formats not stated; errors shown away from the field, by colour
alone, or not announced; `autocomplete` missing on fields for personal data.

## ACC-03 Keyboard and focus

Clickable `div` and `span` elements with no role, no `tabIndex` and no key handler; focus
outlines removed with no replacement (`outline: none`); dialogs that do not move focus in, keep
it there, or return it; positive `tabIndex`; focus lost after a route change or a removed item.

## ACC-04 Semantics and ARIA

A `div` doing a button's or a link's job; links used as buttons and the reverse; ARIA roles and
states that contradict the element or never update (`aria-expanded`); `aria-hidden` on focusable
content; custom widgets (tabs, menus, comboboxes) without the keyboard pattern users expect.

## ACC-05 Page structure

The page language (`lang`); a title per page; one `h1` and headings in order; landmarks
(`main`, `nav`); a skip link where navigation is long; route changes in a single-page app that
leave the title as it was.

## ACC-06 Colour and contrast

Colour pairs in the design tokens or styles under 4.5:1 for text, or 3:1 for large text and
controls, where both colours are in the code; colour as the only cue (errors in red, status
dots); text in images.

## ACC-07 Motion and media

Carousels, animations and media that start on their own with no way to pause them; audio that
plays automatically; video without captions; animations with no `prefers-reduced-motion`
alternative.

## ACC-08 Dynamic content

Status messages (added to cart, saved, an error after submit) outside a live region; content
loaded or replaced without the screen reader hearing of it; notifications that vanish before
they can be read.
