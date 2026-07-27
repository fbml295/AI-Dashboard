/**
 * downsample.js
 * -----------------------------------------------------------------------
 * Thuật toán LTTB (Largest-Triangle-Three-Buckets).
 * Mục đích: khi 1 tag có hàng chục/hàng trăm nghìn điểm, render thẳng lên
 * ECharts sẽ giật lag. LTTB chọn ra 1 tập điểm đại diện (giữ đúng số lượng
 * `threshold`) nhưng vẫn giữ được HÌNH DẠNG (đỉnh/đáy/dao động) của tín hiệu
 * gốc tốt hơn nhiều so với lấy mẫu đều (mỗi N điểm lấy 1).
 *
 * Input : data = [[x0,y0], [x1,y1], ...]  (x là timestamp dạng số, y là giá trị)
 * Output: mảng con của data, độ dài xấp xỉ `threshold`.
 */

function lttbDownsample(data, threshold) {
  const dataLength = data.length;
  if (threshold >= dataLength || threshold <= 2) {
    return data; // Không cần downsample
  }

  const sampled = [];
  let sampledIndex = 0;

  // Bucket size (trừ điểm đầu/cuối luôn được giữ nguyên)
  const every = (dataLength - 2) / (threshold - 2);

  let a = 0; // điểm được chọn ở bucket trước
  sampled[sampledIndex++] = data[a];

  for (let i = 0; i < threshold - 2; i++) {
    // Tính điểm trung bình của bucket kế tiếp (để tạo tam giác so sánh)
    let avgX = 0, avgY = 0;
    const avgRangeStart = Math.floor((i + 1) * every) + 1;
    let avgRangeEnd = Math.floor((i + 2) * every) + 1;
    avgRangeEnd = avgRangeEnd < dataLength ? avgRangeEnd : dataLength;
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += data[j][0];
      avgY += data[j][1];
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const rangeOffs = Math.floor((i + 0) * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;

    const pointAX = data[a][0];
    const pointAY = data[a][1];

    let maxArea = -1;
    let maxAreaPoint = null;
    let nextA = rangeOffs;

    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs(
        (pointAX - avgX) * (data[j][1] - pointAY) -
        (pointAX - data[j][0]) * (avgY - pointAY)
      ) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        maxAreaPoint = data[j];
        nextA = j;
      }
    }

    sampled[sampledIndex++] = maxAreaPoint;
    a = nextA;
  }

  sampled[sampledIndex++] = data[dataLength - 1];
  return sampled;
}

window.lttbDownsample = lttbDownsample;
