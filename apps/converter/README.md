# RoleSave converter

Turns a saved job page (MHTML from the extension) into a PDF with Chromium. The
worker runs it once per save inside the Docker image built from this folder,
with no network, a read-only file system, and no Linux capabilities, because the
page it opens is untrusted.

```sh
pnpm mhtml:image:build         # build rolesave-mhtml-converter:local
pnpm converter:verify:image    # convert the fixture inside the image, as the worker does
pnpm converter:verify          # the same with the Chrome on this computer
pnpm converter:convert --input page.mhtml --output page.pdf [--metadata page.json]
```

Before printing, the converter blocks every network request, removes fixed and
sticky page chrome that would repeat on each page, and hides icon-font text. It
refuses a page with fewer than 50 visible characters and exits with code 3, so
the worker reports it at once instead of retrying.

`MHTML_CHROME_PATH` chooses the Chrome binary. The image sets it to the Chromium
that ships with its Playwright base image.
