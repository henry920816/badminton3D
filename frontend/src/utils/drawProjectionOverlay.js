import { project3DToImage } from './cameraProjection.js';

function getObjectContainRect(container, video) {
  const boxWidth = Math.max(1, Math.round(container?.clientWidth || video?.clientWidth || 0));
  const boxHeight = Math.max(1, Math.round(container?.clientHeight || video?.clientHeight || 0));
  const videoWidth = video?.videoWidth || 1280;
  const videoHeight = video?.videoHeight || 800;
  const boxRatio = boxWidth / boxHeight;
  const videoRatio = videoWidth / videoHeight;
  let width = boxWidth;
  let height = boxHeight;
  let x = 0;
  let y = 0;
  if (boxRatio > videoRatio) {
    height = boxHeight;
    width = height * videoRatio;
    x = (boxWidth - width) / 2;
  } else {
    width = boxWidth;
    height = width / videoRatio;
    y = (boxHeight - height) / 2;
  }
  return {
    boxWidth,
    boxHeight,
    x,
    y,
    width,
    height
  };
}
export function getImagePointFromPointer({
  event,
  canvas,
  container,
  video,
  cameraParams
}) {
  if (!event || !canvas || !container || !video) {
    return null;
  }
  const rectangle = getObjectContainRect(container, video);
  const canvasRectangle = canvas.getBoundingClientRect();
  const canvasX = event.clientX - canvasRectangle.left;
  const canvasY = event.clientY - canvasRectangle.top;
  if (canvasX < rectangle.x || canvasX > rectangle.x + rectangle.width || canvasY < rectangle.y || canvasY > rectangle.y + rectangle.height) {
    return null;
  }
  const imageWidth = cameraParams?.imageWidth || video.videoWidth || 1920;
  const imageHeight = cameraParams?.imageHeight || video.videoHeight || 1200;
  return {
    x: (canvasX - rectangle.x) * imageWidth / rectangle.width,
    y: (canvasY - rectangle.y) * imageHeight / rectangle.height
  };
}
export function drawProjectionOverlay({
  canvas,
  container,
  video,
  cameraParams,
  trajectoryMap,
  candidate3DPoint,
  currentFrame,
  showProjection,
  ball2DMap,
  showBall2D,
  repair2DMode,
  repairObservation,
  repairPreviewPoint,
  epipolarGuide,
  correctionOverlay
}) {
  if (!canvas || !container || !video) {
    return;
  }
  const rectangle = getObjectContainRect(container, video);
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.style.width = `${rectangle.boxWidth}px`;
  canvas.style.height = `${rectangle.boxHeight}px`;
  canvas.width = Math.max(1, Math.round(rectangle.boxWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(rectangle.boxHeight * pixelRatio));
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, rectangle.boxWidth, rectangle.boxHeight);
  const drawPoint = ({
    u,
    v,
    imageWidth,
    imageHeight,
    fillStyle,
    radius,
    strokeStyle = null,
    hollow = false,
    strokeWidth = 1.5
  }) => {
    if (!Number.isFinite(Number(u)) || !Number.isFinite(Number(v)) || !Number.isFinite(Number(imageWidth)) || !Number.isFinite(Number(imageHeight)) || Number(imageWidth) <= 0 || Number(imageHeight) <= 0) {
      return;
    }
    const canvasX = rectangle.x + Number(u) * rectangle.width / Number(imageWidth);
    const canvasY = rectangle.y + Number(v) * rectangle.height / Number(imageHeight);
    context.save();
    context.fillStyle = fillStyle;
    context.shadowColor = 'rgba(0, 0, 0, 0.85)';
    context.shadowBlur = 4;
    context.beginPath();
    context.arc(canvasX, canvasY, radius, 0, Math.PI * 2);
    if (!hollow) context.fill();
    if (strokeStyle || hollow) {
      context.strokeStyle = strokeStyle || fillStyle;
      context.lineWidth = strokeWidth;
      context.stroke();
    }
    context.restore();
  };
  if (showProjection && cameraParams) {
    const currentPoint =
    // 2D 修正參考必須使用「同一 frame」的原始 3D；
    // 不能偷偷拿附近 3 格的球當成當前位置。
    trajectoryMap?.get(currentFrame) || null;
    const projection = currentPoint ? project3DToImage(currentPoint, cameraParams) : null;
    if (projection) {
      drawPoint({
        u: projection.u,
        v: projection.v,
        imageWidth: cameraParams.imageWidth || video.videoWidth || 1920,
        imageHeight: cameraParams.imageHeight || video.videoHeight || 1200,
        fillStyle: '#ef4444',
        hollow: true,
        strokeWidth: 2.3,
        radius: 6
      });
    }
  }

  // A prediction is not an independent 2D observation.
  if (candidate3DPoint && cameraParams) {
    const suggestion = project3DToImage(candidate3DPoint, cameraParams);
    if (suggestion) {
      drawPoint({
        u: suggestion.u,
        v: suggestion.v,
        imageWidth: cameraParams.imageWidth || video.videoWidth || 1920,
        imageHeight: cameraParams.imageHeight || video.videoHeight || 1200,
        fillStyle: '#10b981',
        hollow: true,
        strokeWidth: 2.1,
        radius: 6
      });
    }
  }
  // 只在手動修正模式開啟時，畫出其他視角標註形成的極線。
  if (epipolarGuide?.lines?.length && cameraParams) {
    const width = Number(cameraParams.imageWidth || video.videoWidth || 1920);
    const height = Number(cameraParams.imageHeight || video.videoHeight || 1200);
    context.save();
    context.strokeStyle = 'rgba(34,211,238,0.65)';
    context.lineWidth = 1.3;
    context.setLineDash([5, 4]);
    for (const line of epipolarGuide.lines) {
      context.beginPath();
      line.points.forEach((point, index) => {
        const u = rectangle.x + point.u * rectangle.width / width;
        const v = rectangle.y + point.v * rectangle.height / height;
        if (index === 0) context.moveTo(u, v);
        else context.lineTo(u, v);
      });
      context.stroke();
    }
    context.restore();
    const minimum = epipolarGuide.minimum;
    if (minimum && Number.isFinite(minimum.u) && Number.isFinite(minimum.v)) {
      drawPoint({ u: minimum.u, v: minimum.v, imageWidth: width, imageHeight: height,
        fillStyle: '#f0abfc', hollow: true, strokeWidth: 2, radius: 7 });
    }
  }
  const ball2DPoint = ball2DMap?.get(currentFrame);
  if (showBall2D && Number(ball2DPoint?.visibility) === 1) {
    drawPoint({
      u: ball2DPoint.x,
      v: ball2DPoint.y,
      imageWidth: cameraParams?.imageWidth || video.videoWidth || 1920,
      imageHeight: cameraParams?.imageHeight || video.videoHeight || 1200,
      fillStyle: '#22d3ee00',
      strokeStyle: '#22d3ee',
      radius: 5
    });
  }
  if (repair2DMode && repairObservation) {
    drawPoint({
      u: repairObservation.x,
      v: repairObservation.y,
      imageWidth: cameraParams?.imageWidth || video.videoWidth || 1920,
      imageHeight: cameraParams?.imageHeight || video.videoHeight || 1200,
      fillStyle: '#d946ef',
      strokeStyle: '#fae8ff',
      radius: 6
    });
  }
  if (repair2DMode && repairPreviewPoint && cameraParams) {
    const previewProjection = project3DToImage(repairPreviewPoint, cameraParams);
    if (previewProjection) {
      drawPoint({
        u: previewProjection.u,
        v: previewProjection.v,
        imageWidth: cameraParams.imageWidth || video.videoWidth || 1920,
        imageHeight: cameraParams.imageHeight || video.videoHeight || 1200,
        fillStyle: '#22c55e',
        hollow: true,
        strokeWidth: 2.1,
        radius: 7
      });
    }
  }

  // 2D 標註修正：灰圈是原始標註，琥珀色實心點是修正後的位置
  if (correctionOverlay) {
    const imageWidth = cameraParams?.imageWidth || video.videoWidth || 1920;
    const imageHeight = cameraParams?.imageHeight || video.videoHeight || 1200;
    const {
      original,
      correction
    } = correctionOverlay;
    if (Number(original?.visibility) === 1) {
      drawPoint({
        u: original.x,
        v: original.y,
        imageWidth,
        imageHeight,
        fillStyle: 'rgba(0, 0, 0, 0)',
        strokeStyle: '#a1a1aa',
        radius: 8
      });
    }
    if (Number(correction?.visibility) === 1) {
      drawPoint({
        u: correction.x,
        v: correction.y,
        imageWidth,
        imageHeight,
        fillStyle: '#f59e0b',
        strokeStyle: '#fef3c7',
        radius: 5
      });
    }
  }
}
