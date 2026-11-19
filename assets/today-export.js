export async function exportPng(items, offset, timestamp, getCandidates) {
  const columns = 4;
  const tileWidth = 240;
  const tileHeight = 185;
  const coverHeight = 126;
  const padding = 16;
  const header = 62;
  const canvas = document.createElement("canvas");
  canvas.width = columns * (tileWidth + padding) + padding;
  canvas.height = header + Math.ceil(items.length / columns) * (tileHeight + padding);
  const context = canvas.getContext("2d");
  context.fillStyle = "#f0edf8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#211a39";
  context.font = "bold 22px sans-serif";
  context.fillText("今日热度 · " + timestamp + "（台北）", padding, 37);

  try {
    for (let index = 0; index < items.length; index += columns) {
      const row = items.slice(index, index + columns);
      const images = await Promise.all(row.map((item) => loadCover(getCandidates(item))));
      row.forEach((item, column) => {
        const x = padding + column * (tileWidth + padding);
        const y = header + Math.floor(index / columns) * (tileHeight + padding);
        const image = images[column];
        context.fillStyle = "#fff";
        context.fillRect(x, y, tileWidth, tileHeight);
        context.fillStyle = "#e1dbed";
        context.fillRect(x, y, tileWidth, coverHeight);
        if (image) {
          const scale = Math.max(tileWidth / image.width, coverHeight / image.height);
          const sourceWidth = tileWidth / scale;
          const sourceHeight = coverHeight / scale;
          context.drawImage(image, (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2,
            sourceWidth, sourceHeight, x, y, tileWidth, coverHeight);
        }
        context.fillStyle = "#211a39";
        context.font = "bold 14px sans-serif";
        drawLine(context, "#" + (offset + index + column + 1) + " " + (item.title || "无标题"), x + 9, y + 148, tileWidth - 18);
        context.fillStyle = "#595270";
        context.font = "13px sans-serif";
        drawLine(context, (item.channelName || "未知频道") + " · " + item.keyword, x + 9, y + 169, tileWidth - 18);
      });
    }
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成 PNG")), "image/png");
    });
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function drawLine(context, value, x, y, width) {
  if (context.measureText(value).width <= width) {
    context.fillText(value, x, y);
    return;
  }
  let text = "";
  for (const letter of value) {
    if (context.measureText(text + letter + "…").width > width) break;
    text += letter;
  }
  context.fillText(text + "…", x, y);
}

async function loadCover(urls) {
  for (const url of urls) {
    const image = await new Promise((resolve) => {
      const candidate = new Image();
      function finish(result) {
        clearTimeout(timer);
        candidate.onload = candidate.onerror = null;
        if (!result) candidate.removeAttribute("src");
        resolve(result);
      }
      const timer = setTimeout(() => finish(null), 2500);
      candidate.crossOrigin = "anonymous";
      candidate.onload = () => finish(candidate.naturalWidth >= 160 ? candidate : null);
      candidate.onerror = () => finish(null);
      candidate.src = url;
    });
    if (image) return image;
  }
  return null;
}
