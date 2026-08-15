export function movingAverage(rows, window) {
  return rows.map((row, index) => {
    if (index + 1 < window) return null;
    const sample = rows.slice(index + 1 - window, index + 1).map((item) => item.close).filter(Number.isFinite);
    return sample.length === window ? sample.reduce((sum, value) => sum + value, 0) / window : null;
  });
}
