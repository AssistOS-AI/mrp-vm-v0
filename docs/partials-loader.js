async function loadPartials() {
  const nodes = document.querySelectorAll('[data-include]');
  await Promise.all(
    Array.from(nodes).map(async (node) => {
      const target = node.getAttribute('data-include');
      if (!target) {
        return;
      }
      const response = await fetch(target);
      if (!response.ok) {
        node.innerHTML = `<p class="callout callout--warning">Failed to load partial: ${target}</p>`;
        return;
      }
      node.innerHTML = await response.text();
    })
  );
}

window.addEventListener('DOMContentLoaded', () => {
  loadPartials().catch((error) => {
    console.error(error);
  });
});
