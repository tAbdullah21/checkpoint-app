// Geometry for the "taste DNA" radar chart: turns traits with a share (%) into SVG points.
// Pure function, rendered server-side as an inline SVG (no chart library, no JavaScript).

function round(value) {
  return Math.round(value * 10) / 10;
}

function radarChart(traits, { size = 340, padding = 70, levels = 4, minimum = 0.14 } = {}) {
  const items = (traits || []).filter((trait) => trait && trait.label).slice(0, 8);
  if (items.length < 3) return null;

  const center = size / 2;
  const radius = center - padding;
  const strongest = Math.max(1, ...items.map((trait) => Number(trait.share) || 0));
  const angle = (index) => -Math.PI / 2 + (2 * Math.PI * index) / items.length;
  const point = (index, ratio) => [center + Math.cos(angle(index)) * radius * ratio, center + Math.sin(angle(index)) * radius * ratio];
  const toPoints = (pairs) => pairs.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');

  const rings = Array.from({ length: levels }, (_, level) => toPoints(items.map((_, index) => point(index, (level + 1) / levels))));
  const axes = items.map((_, index) => {
    const [x, y] = point(index, 1);
    return { x: round(x), y: round(y) };
  });
  const values = items.map((trait) => Math.max(minimum, (Number(trait.share) || 0) / strongest));
  const dots = values.map((value, index) => {
    const [x, y] = point(index, value);
    return { x: round(x), y: round(y) };
  });
  // Labels sit outside the outer ring; the name and its percentage form a two-line block that grows away
  // from the chart (upwards above the centre, downwards below it), so text never covers a data point.
  const labels = items.map((trait, index) => {
    const [x, y] = point(index, 1.16);
    const offsetX = x - center;
    const offsetY = y - center;
    let anchor = 'middle';
    if (offsetX > 4) anchor = 'start';
    else if (offsetX < -4) anchor = 'end';
    const top = offsetY < -radius * 0.5 ? y - 22 : offsetY > radius * 0.5 ? y + 4 : y - 9;
    return { x: round(x), y: round(top), anchor, label: trait.label, share: Number(trait.share) || 0 };
  });

  return { size, center, rings, axes, shape: toPoints(dots.map((dot) => [dot.x, dot.y])), dots, labels };
}

// Two players on one radar ("Compare tastes"): traits are { label, first, second } shares in %.
// Both shapes share one scale, so the bigger shape on an axis really is the stronger taste.
function compareRadar(traits, { size = 340, padding = 70, levels = 4, minimum = 0.08 } = {}) {
  const items = (traits || []).filter((trait) => trait && trait.label).slice(0, 8);
  if (items.length < 3) return null;

  const center = size / 2;
  const radius = center - padding;
  const strongest = Math.max(1, ...items.flatMap((trait) => [Number(trait.first) || 0, Number(trait.second) || 0]));
  const angle = (index) => -Math.PI / 2 + (2 * Math.PI * index) / items.length;
  const point = (index, ratio) => [center + Math.cos(angle(index)) * radius * ratio, center + Math.sin(angle(index)) * radius * ratio];
  const toPoints = (pairs) => pairs.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
  const series = (key) => items.map((trait, index) => {
    const [x, y] = point(index, Math.max(minimum, (Number(trait[key]) || 0) / strongest));
    return { x: round(x), y: round(y) };
  });

  const first = series('first');
  const second = series('second');
  const labels = items.map((trait, index) => {
    const [x, y] = point(index, 1.16);
    const offsetX = x - center;
    const offsetY = y - center;
    let anchor = 'middle';
    if (offsetX > 4) anchor = 'start';
    else if (offsetX < -4) anchor = 'end';
    const top = offsetY < -radius * 0.5 ? y - 22 : offsetY > radius * 0.5 ? y + 4 : y - 9;
    return { x: round(x), y: round(top), anchor, label: trait.label, first: Number(trait.first) || 0, second: Number(trait.second) || 0 };
  });

  return {
    size,
    center,
    rings: Array.from({ length: levels }, (_, level) => toPoints(items.map((_, index) => point(index, (level + 1) / levels)))),
    axes: items.map((_, index) => {
      const [x, y] = point(index, 1);
      return { x: round(x), y: round(y) };
    }),
    first: { shape: toPoints(first.map((dot) => [dot.x, dot.y])), dots: first },
    second: { shape: toPoints(second.map((dot) => [dot.x, dot.y])), dots: second },
    labels,
  };
}

module.exports = { compareRadar, radarChart };
