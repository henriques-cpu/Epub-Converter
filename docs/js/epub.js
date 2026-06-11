// Fixed-layout EPUB 3 builder — ported from mangaconv/core/epubbuilder.py.
// Built with fflate. The mimetype entry MUST be first and stored uncompressed.

import { zipSync, strToU8 } from "../vendor/fflate.js";

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

function pageXhtml(title, w, h, img) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <meta name="viewport" content="width=${w}, height=${h}"/>
  <style>
    html, body { margin: 0; padding: 0; }
    img { width: 100%; height: 100%; object-fit: contain; display: block; }
  </style>
</head>
<body>
  <div class="page">
    <img src="../images/${img}" alt="${title}" width="${w}" height="${h}"/>
  </div>
</body>
</html>
`;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function buildOpf(bookId, title, language, pages, direction) {
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const manifest = ['    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'];
  const spine = [];
  pages.forEach((p, i) => {
    const pid = `page${String(i).padStart(4, "0")}`;
    const iid = `img${String(i).padStart(4, "0")}`;
    manifest.push(`    <item id="${pid}" href="xhtml/${pid}.xhtml" media-type="application/xhtml+xml"/>`);
    const coverProp = i === 0 ? ' properties="cover-image"' : "";
    manifest.push(`    <item id="${iid}" href="images/${iid}.${p.ext}" media-type="${p.mediaType}"${coverProp}/>`);
    spine.push(`    <itemref idref="${pid}"/>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"
         prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${bookId}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${language}</dc:language>
    <dc:creator>mangaconv</dc:creator>
    <meta property="dcterms:modified">${modified}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">portrait</meta>
    <meta property="rendition:spread">none</meta>
  </metadata>
  <manifest>
${manifest.join("\n")}
  </manifest>
  <spine page-progression-direction="${direction}">
${spine.join("\n")}
  </spine>
</package>
`;
}

function buildNav(title) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${title}</h1>
    <ol>
        <li><a href="xhtml/page0000.xhtml">Page 1</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

// pages: [{ bytes: Uint8Array, width, height, mediaType, ext }]
// Returns a Uint8Array (the .epub file).
export function buildFixedLayoutEpub(pages, { title = "Untitled", language = "en", rightToLeft = true } = {}) {
  if (!pages.length) throw new Error("Cannot build an EPUB with zero pages.");
  const bookId = uuid();
  const direction = rightToLeft ? "rtl" : "ltr";

  const files = {};
  // mimetype: first entry, stored (level 0).
  files["mimetype"] = [strToU8("application/epub+zip"), { level: 0 }];
  files["META-INF/container.xml"] = strToU8(CONTAINER_XML);
  files["OEBPS/content.opf"] = strToU8(buildOpf(bookId, title, language, pages, direction));
  files["OEBPS/nav.xhtml"] = strToU8(buildNav(title));

  pages.forEach((p, i) => {
    const pid = `page${String(i).padStart(4, "0")}`;
    const iid = `img${String(i).padStart(4, "0")}`;
    files[`OEBPS/xhtml/${pid}.xhtml`] = strToU8(
      pageXhtml(`${title} — ${i + 1}`, p.width, p.height, `${iid}.${p.ext}`)
    );
    // Images are already compressed; store to avoid wasted work.
    files[`OEBPS/images/${iid}.${p.ext}`] = [p.bytes, { level: 0 }];
  });

  return zipSync(files, { level: 6 });
}
