/**
 * chart.js
 * -----------------------------------------------------------------------
 * Vẽ trendline đa tín hiệu bằng Apache ECharts.
 *
 * Chiến lược hiệu năng cho dữ liệu lớn:
 *  1. Mỗi tag khi bật lên sẽ được downsample bằng LTTB xuống còn tối đa
 *     APP_CONFIG.DOWNSAMPLE_THRESHOLD điểm trước khi đưa vào ECharts.
 *  2. Bật `large: true` + `sampling: 'lttb'` (dự phòng thêm ở tầng ECharts)
 *     và tắt animation cho line để tránh giật khi có nhiều series.
 *  3. Chỉ re-render toàn bộ option khi danh sách tag BẬT thay đổi, không
 *     re-parse dữ liệu gốc mỗi lần toggle.
 *
 * Chiến lược nhiều thang đo (units khác nhau):
 *  - Mặc định: mỗi tag có 1 trục Y riêng (ẩn), giúp true value hiển thị
 *    đúng khi hover, không bị "đường phẳng" do lệch scale.
 *  - Chế độ "Chuẩn hoá 0-100%": Min-Max normalize tất cả series đang bật
 *    về cùng thang [0,100] để so sánh HÌNH DẠNG dao động giữa các tín hiệu
 *    khác đơn vị (vd so vibration với temperature).
 */

const ChartModule = (() => {
  let chartInstance = null;
  let currentDataset = null; // { timestamps, series, rowCount }

  function init(domId) {
    const el = document.getElementById(domId);
    chartInstance = echarts.init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => chartInstance.resize());
    renderEmpty();
    return chartInstance;
  }

  function renderEmpty() {
    chartInstance.setOption({
      backgroundColor: 'transparent',
      textStyle: { color: '#8fa3b8', fontFamily: 'IBM Plex Mono, monospace' },
      title: {
        text: 'Chọn ít nhất 1 tín hiệu ở panel bên trái để hiển thị trendline',
        left: 'center',
        top: 'middle',
        textStyle: { color: '#3d4c5f', fontSize: 14, fontWeight: 'normal' },
      },
      xAxis: { show: false },
      yAxis: { show: false },
    }, true);
  }

  function minMax(arr) {
    let min = Infinity, max = -Infinity;
    for (const v of arr) {
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (min === max) return [min - 1, max + 1];
    return [min, max];
  }

  /**
   * selectedKeys: array of tag keys (numeric only, categorical hiển thị riêng ở nơi khác)
   * dataset: { timestamps, series }
   * options: { normalize: boolean }
   */
  function render(selectedKeys, dataset, options = {}) {
    currentDataset = dataset;
    if (!selectedKeys || selectedKeys.length === 0) {
      renderEmpty();
      return;
    }

    const { timestamps, series } = dataset;
    const normalize = !!options.normalize;
    const threshold = APP_CONFIG.DOWNSAMPLE_THRESHOLD;

    const echartSeries = [];
    const yAxes = [];

    selectedKeys.forEach((key, idx) => {
      const def = TAG_DEFINITIONS.find(t => t.key === key);
      if (!def) return;

      const rawValues = series[key];
      let paired = timestamps.map((t, i) => [t, rawValues[i]]).filter(p => Number.isFinite(p[1]));

      // Downsample nếu vượt ngưỡng
      const sampled = paired.length > threshold ? window.lttbDownsample(paired, threshold) : paired;

      let plotData = sampled;
      let axisLabelFormatter = (v) => `${v}${def.unit ? ' ' + def.unit : ''}`;

      if (normalize) {
        const [min, max] = minMax(sampled.map(p => p[1]));
        plotData = sampled.map(p => [p[0], ((p[1] - min) / (max - min)) * 100]);
        axisLabelFormatter = (v) => `${v}%`;
      }

      const yAxisIndex = normalize ? 0 : idx;

      if (!normalize || idx === 0) {
        yAxes.push({
          type: 'value',
          show: normalize ? idx === 0 : selectedKeys.length === 1,
          position: 'left',
          offset: 0,
          axisLine: { lineStyle: { color: def.color || '#00e5ff' } },
          axisLabel: { formatter: axisLabelFormatter, color: '#8fa3b8' },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
          scale: true,
        });
      }

      echartSeries.push({
        name: `${def.label}${def.unit ? ' (' + def.unit + ')' : ''}`,
        type: 'line',
        showSymbol: false,
        smooth: false,
        animation: false,
        large: true,
        largeThreshold: 500,
        sampling: 'lttb',
        lineStyle: { width: 1.6, color: def.color || '#00e5ff' },
        itemStyle: { color: def.color || '#00e5ff' },
        yAxisIndex,
        data: plotData,
      });
    });

    const option = {
      backgroundColor: 'transparent',
      textStyle: { color: '#8fa3b8', fontFamily: 'IBM Plex Mono, monospace' },
      animation: false,
      color: selectedKeys.map(k => (TAG_DEFINITIONS.find(t => t.key === k) || {}).color || '#00e5ff'),
      grid: { left: 60, right: 30, top: 50, bottom: 60, containLabel: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#10161f',
        borderColor: '#1f2937',
        textStyle: { color: '#e2e8f0', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 },
        axisPointer: { type: 'cross', label: { backgroundColor: '#1f2937' } },
        formatter: (params) => {
          if (!params.length) return '';
          const time = new Date(params[0].axisValue).toLocaleString('vi-VN');
          let html = `<div style="margin-bottom:4px;color:#3d4c5f;">${time}</div>`;
          params.forEach(p => {
            const val = normalize ? p.data[1].toFixed(1) + '%' : Number(p.data[1]).toFixed(2);
            html += `<div><span style="color:${p.color};">●</span> ${p.seriesName}: <b>${val}</b></div>`;
          });
          return html;
        },
      },
      legend: {
        top: 8,
        textStyle: { color: '#8fa3b8', fontSize: 11 },
        icon: 'roundRect',
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { type: 'slider', start: 0, end: 100, height: 18, bottom: 20,
          borderColor: '#1f2937', fillerColor: 'rgba(0,229,255,0.1)',
          handleStyle: { color: '#00e5ff' },
          textStyle: { color: '#8fa3b8' } },
      ],
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#1f2937' } },
        axisLabel: { color: '#8fa3b8' },
        splitLine: { show: false },
      },
      yAxis: normalize ? yAxes : yAxes,
      series: echartSeries,
    };

    chartInstance.setOption(option, true);
  }

  /**
   * Lấy mẫu dữ liệu đại diện của các tag đang hiển thị để gửi cho Gemini.
   * Để tiết kiệm token & chi phí, chỉ gửi tối đa `maxPoints` điểm/​tag
   * (đã downsample) kèm thống kê mô tả (min/max/mean/std).
   */
  function getSummaryForAI(selectedKeys, dataset, maxPoints = 200) {
    const { timestamps, series } = dataset;
    const summary = {};

    selectedKeys.forEach((key) => {
      const def = TAG_DEFINITIONS.find(t => t.key === key);
      const rawValues = series[key];
      const paired = timestamps.map((t, i) => [t, rawValues[i]]).filter(p => Number.isFinite(p[1]));
      if (!paired.length) return;

      const sampled = paired.length > maxPoints ? window.lttbDownsample(paired, maxPoints) : paired;
      const values = paired.map(p => p[1]);
      const n = values.length;
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;

      summary[key] = {
        label: def ? def.label : key,
        unit: def ? def.unit : '',
        stats: {
          min: Math.min(...values),
          max: Math.max(...values),
          mean: Number(mean.toFixed(3)),
          std: Number(Math.sqrt(variance).toFixed(3)),
          count: n,
        },
        sample: sampled.map(p => [new Date(p[0]).toISOString(), Number(p[1].toFixed(3))]),
      };
    });

    return summary;
  }

  return { init, render, getSummaryForAI, renderEmpty };
})();

window.ChartModule = ChartModule;
