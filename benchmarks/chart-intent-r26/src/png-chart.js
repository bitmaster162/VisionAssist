import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0
      ? 0xedb88320 ^ (crc >>> 1)
      : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function setPixel(pixels, width, height, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || px >= width || py < 0 || py >= height) {
    return;
  }
  const offset = (py * width + px) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3] ?? 255;
}

function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + rectWidth));
  const bottom = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      setPixel(pixels, width, height, px, py, color);
    }
  }
}

function drawLine(pixels, width, height, x0, y0, x1, y1, color) {
  let startX = Math.round(x0);
  let startY = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  const dx = Math.abs(endX - startX);
  const sx = startX < endX ? 1 : -1;
  const dy = -Math.abs(endY - startY);
  const sy = startY < endY ? 1 : -1;
  let error = dx + dy;

  while (true) {
    setPixel(pixels, width, height, startX, startY, color);
    if (startX === endX && startY === endY) {
      break;
    }
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      startX += sx;
    }
    if (doubled <= dx) {
      error += dx;
      startY += sy;
    }
  }
}

function drawCircle(
  pixels,
  width,
  height,
  centerX,
  centerY,
  radius,
  color,
  { filled = true } = {}
) {
  const radiusSquared = radius * radius;
  const innerRadiusSquared = Math.max(0, (radius - 2) * (radius - 2));
  for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y += 1) {
    for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x += 1) {
      const distanceSquared =
        (x - centerX) * (x - centerX) +
        (y - centerY) * (y - centerY);
      if (
        distanceSquared <= radiusSquared &&
        (filled || distanceSquared >= innerRadiusSquared)
      ) {
        setPixel(pixels, width, height, x, y, color);
      }
    }
  }
}

function encodeRgbaPng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) {
    const destinationOffset = row * (1 + width * 4);
    scanlines[destinationOffset] = 0;
    pixels.copy(
      scanlines,
      destinationOffset + 1,
      row * width * 4,
      (row + 1) * width * 4
    );
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

export function renderCandlestickPng(bars, {
  width = 960,
  height = 540
} = {}) {
  if (!Array.isArray(bars) || bars.length < 20) {
    throw new TypeError("At least 20 visible bars are required to render a chart.");
  }

  const numericFields = bars.flatMap((bar) => [
    bar.open,
    bar.high,
    bar.low,
    bar.close
  ]);
  if (numericFields.some((value) => !Number.isFinite(value))) {
    throw new TypeError("All OHLC values must be finite numbers.");
  }

  const background = [247, 245, 238, 255];
  const grid = [214, 211, 200, 255];
  const axis = [95, 96, 91, 255];
  const up = [15, 124, 103, 255];
  const down = [190, 61, 55, 255];
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = background[0];
    pixels[offset + 1] = background[1];
    pixels[offset + 2] = background[2];
    pixels[offset + 3] = background[3];
  }

  const plot = {
    left: 34,
    top: 24,
    right: width - 24,
    bottom: height - 30
  };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));
  const rawRange = high - low;
  const padding = rawRange > 0 ? rawRange * 0.06 : Math.max(Math.abs(high) * 0.01, 1);
  const minimum = low - padding;
  const maximum = high + padding;
  const range = maximum - minimum;
  const toY = (price) =>
    plot.bottom - ((price - minimum) / range) * plotHeight;

  for (let line = 0; line <= 5; line += 1) {
    const y = plot.top + (plotHeight * line) / 5;
    drawLine(pixels, width, height, plot.left, y, plot.right, y, grid);
  }
  for (let line = 0; line <= 8; line += 1) {
    const x = plot.left + (plotWidth * line) / 8;
    drawLine(pixels, width, height, x, plot.top, x, plot.bottom, grid);
  }
  drawLine(pixels, width, height, plot.left, plot.top, plot.left, plot.bottom, axis);
  drawLine(pixels, width, height, plot.left, plot.bottom, plot.right, plot.bottom, axis);

  const step = plotWidth / bars.length;
  const bodyWidth = Math.max(3, Math.floor(step * 0.58));
  bars.forEach((bar, index) => {
    const x = plot.left + step * (index + 0.5);
    const color = bar.close >= bar.open ? up : down;
    drawLine(pixels, width, height, x, toY(bar.high), x, toY(bar.low), color);
    const openY = toY(bar.open);
    const closeY = toY(bar.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(2, Math.abs(openY - closeY));
    fillRect(
      pixels,
      width,
      height,
      x - bodyWidth / 2,
      bodyTop,
      bodyWidth,
      bodyHeight,
      color
    );
  });

  return encodeRgbaPng(width, height, pixels);
}

export function renderAgentIntentPng(scene, {
  width = 960,
  height = 540,
  revealFuture = false
} = {}) {
  if (
    !scene ||
    !Array.isArray(scene.targets) ||
    scene.targets.length !== 2 ||
    !Array.isArray(scene.obstacles) ||
    !Array.isArray(scene.visible_trail) ||
    !scene.agent
  ) {
    throw new TypeError("Agent scene has an invalid shape.");
  }

  const background = [244, 241, 230, 255];
  const border = [89, 91, 86, 255];
  const obstacle = [72, 79, 82, 255];
  const trail = [109, 126, 126, 255];
  const futureTrail = [70, 153, 117, 255];
  const agent = [13, 111, 101, 255];
  const finalAgent = [9, 88, 79, 255];
  const targetColors = [
    [50, 103, 184, 255],
    [219, 126, 40, 255]
  ];
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = background[0];
    pixels[offset + 1] = background[1];
    pixels[offset + 2] = background[2];
    pixels[offset + 3] = background[3];
  }

  drawLine(pixels, width, height, 24, 20, width - 24, 20, border);
  drawLine(pixels, width, height, width - 24, 20, width - 24, height - 20, border);
  drawLine(pixels, width, height, width - 24, height - 20, 24, height - 20, border);
  drawLine(pixels, width, height, 24, height - 20, 24, 20, border);

  scene.obstacles.forEach((item) => {
    fillRect(
      pixels,
      width,
      height,
      item.x,
      item.y,
      item.width,
      item.height,
      obstacle
    );
  });

  scene.targets.forEach((target, index) => {
    const color = targetColors[index];
    if (target.shape === "square") {
      fillRect(
        pixels,
        width,
        height,
        target.x - target.radius,
        target.y - target.radius,
        target.radius * 2,
        target.radius * 2,
        color
      );
      fillRect(
        pixels,
        width,
        height,
        target.x - target.radius + 5,
        target.y - target.radius + 5,
        target.radius * 2 - 10,
        target.radius * 2 - 10,
        background
      );
    } else {
      drawCircle(
        pixels,
        width,
        height,
        target.x,
        target.y,
        target.radius,
        color,
        { filled: false }
      );
    }
  });

  for (let index = 1; index < scene.visible_trail.length; index += 1) {
    const previous = scene.visible_trail[index - 1];
    const current = scene.visible_trail[index];
    drawLine(
      pixels,
      width,
      height,
      previous.x,
      previous.y,
      current.x,
      current.y,
      trail
    );
  }
  scene.visible_trail.forEach((point) =>
    drawCircle(pixels, width, height, point.x, point.y, 3, trail)
  );

  if (revealFuture && Array.isArray(scene.future_trail)) {
    let previous = scene.agent;
    for (const point of scene.future_trail) {
      drawLine(
        pixels,
        width,
        height,
        previous.x,
        previous.y,
        point.x,
        point.y,
        futureTrail
      );
      previous = point;
    }
    scene.future_trail.forEach((point, index) => {
      if (index % 2 === 1) {
        drawCircle(pixels, width, height, point.x, point.y, 2, futureTrail);
      }
    });
    const finalPoint = scene.future_trail.at(-1);
    drawCircle(
      pixels,
      width,
      height,
      finalPoint.x,
      finalPoint.y,
      scene.agent.radius + 2,
      finalAgent
    );
  }

  drawCircle(
    pixels,
    width,
    height,
    scene.agent.x,
    scene.agent.y,
    scene.agent.radius,
    agent
  );
  return encodeRgbaPng(width, height, pixels);
}
