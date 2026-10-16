// Tiny, safe markdown renderer for agent replies (escape first, then format).
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s) {
  return s
    .replace(/`([a-z0-9-]{6,40})`/gi, (_, id) => `<a class="pid" href="/pact/${id}">${id}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:]|$)/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
}

export function renderMarkdown(text = "") {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`<${list}>${out.splice(out.lastIndexOf("@@list"), Infinity).slice(1).join("")}</${list}>`); list = null; } };
  for (const raw of esc(text).split("\n")) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[*-]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (ul || ol) {
      const type = ul ? "ul" : "ol";
      if (list !== type) { close(); out.push("@@list"); list = type; }
      const indent = /^\s{2,}/.test(line) ? ' class="sub"' : "";
      out.push(`<li${indent}>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    close();
    if (h) out.push(`<h4>${inline(h[1])}</h4>`);
    else if (/^-{3,}$/.test(line.trim())) out.push("<hr/>");
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join("");
}
