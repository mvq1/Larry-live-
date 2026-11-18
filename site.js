// Shared loader for Larry's public pages (GitHub Pages: ./state.json, ./shop.json, ./diary.json).
export async function load(name) {
  const tries = [name + "?t=" + Date.now(), "https://raw.githubusercontent.com/mvq1/Larry-live-/main/" + name + "?t=" + Date.now()];
  for (const u of tries) {
    try { const r = await fetch(u, { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) {}
  }
  return null;
}
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function nav(on) {
  const items = [["index.html", "Live"], ["facts.html", "Facts & mind"], ["diary.html", "Diary"], ["shop.html", "Shop"]];
  return `<nav>${items.map(([h, t]) => `<a href="${h}" class="${t === on ? "on" : ""}">${t}</a>`).join("")}</nav>`;
}
