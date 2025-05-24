const CHART_COLORS = {
    primary: '#3d2645',        // --deep-purple (for main data series)
    secondary: '#da4167',      // --coral (for comparison/problematic data)
    accent: '#832161',         // --magenta (for additional series)
    muted: '#6d4d73',          // --primary-muted (for reference lines)
    light: '#f0eff4',          // --cream (for fills/backgrounds)
    error: '#da4167',          // --coral (for error conditions)
    success: '#3d2645',        // --deep-purple (for good results)
    reference: 'rgba(109, 77, 115, 0.8)', // --primary-muted with opacity
    grid: '#e6d7dc',           // --border-light for grid lines
    white: '#ffffff'           // for point borders
};

// Pre-computed critical t-values 
const CRITICAL_T_VALUES = new Map([
    [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447],
    [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228], [11, 2.201],
    [12, 2.179], [13, 2.160], [14, 2.145], [15, 2.131], [16, 2.120],
    [17, 2.110], [18, 2.101], [19, 2.093], [20, 2.086], [30, 2.042],
    [40, 2.021], [50, 2.009], [100, 1.984], [Infinity, 1.96]
]);

const getCriticalT = (df) => {
    if (CRITICAL_T_VALUES.has(df)) {
        return CRITICAL_T_VALUES.get(df);
    }

    const keys = [...CRITICAL_T_VALUES.keys()].sort((a, b) => a - b);
    let lowerKey = null, upperKey = null;

    for (let i = 0; i < keys.length - 1; i++) {
        if (keys[i] <= df && keys[i + 1] >= df) {
            lowerKey = keys[i];
            upperKey = keys[i + 1];
            break;
        }
    }

    if (lowerKey === null) return CRITICAL_T_VALUES.get(keys[0]);
    if (upperKey === null || upperKey === Infinity) return 1.96;

    const lowerVal = CRITICAL_T_VALUES.get(lowerKey);
    const upperVal = CRITICAL_T_VALUES.get(upperKey);
    const fraction = (df - lowerKey) / (upperKey - lowerKey);

    return lowerVal + fraction * (upperVal - lowerVal);
};

// Responsive breakpoints and utilities
const BREAKPOINTS = {
    mobile: 480,
    tablet: 768,
    desktop: 1024
};

const getScreenSize = () => {
    const width = window.innerWidth;
    if (width <= BREAKPOINTS.mobile) return 'mobile';
    if (width <= BREAKPOINTS.tablet) return 'tablet';
    return 'desktop';
};

const getResponsiveConfig = (screenSize) => {
    const configs = {
        mobile: {
            fontSize: { title: 14, axis: 10, legend: 11, ticks: 9 },
            spacing: { padding: 10, pointRadius: 4, borderWidth: 2 },
            aspectRatio: 1.2,
            legendPosition: 'bottom',
            maxTicksLimit: 5
        },
        tablet: {
            fontSize: { title: 15, axis: 12, legend: 12, ticks: 11 },
            spacing: { padding: 15, pointRadius: 5, borderWidth: 2.5 },
            aspectRatio: 1.6,
            legendPosition: 'top',
            maxTicksLimit: 8
        },
        desktop: {
            fontSize: { title: 16, axis: 14, legend: 13, ticks: 12 },
            spacing: { padding: 20, pointRadius: 6, borderWidth: 3 },
            aspectRatio: 2,
            legendPosition: 'top',
            maxTicksLimit: 10
        }
    };
    return configs[screenSize];
};

// Optimized Box-Muller 
class NormalGenerator {
    constructor() {
        this.hasSpare = false;
        this.spare = 0;
    }

    next(mean = 0, sd = 1) {
        if (this.hasSpare) {
            this.hasSpare = false;
            return this.spare * sd + mean;
        }

        this.hasSpare = true;
        const u = Math.random();
        const v = Math.random();

        const mag = sd * Math.sqrt(-2 * Math.log(u));
        this.spare = mag * Math.cos(2 * Math.PI * v);
        return mag * Math.sin(2 * Math.PI * v) + mean;
    }
}

const normalGen = new NormalGenerator();
const normalRandom = (mean = 0, sd = 1) => normalGen.next(mean, sd);

// Memoization 
class SimulationCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    getKey = (params) => JSON.stringify(params);

    get(params) {
        const key = this.getKey(params);
        if (this.cache.has(key)) {
            const item = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, item);
            return item;
        }
        return null;
    }

    set(params, result) {
        const key = this.getKey(params);
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, result);
    }
}

const simulationCache = new SimulationCache();

// Debounced function with resize handling
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

// Responsive chart configuration with brand colors
const getChartConfig = (title, xAxisLabel, yAxisLabel, yMin = 0, yMax = 1) => {
    const screenSize = getScreenSize();
    const config = getResponsiveConfig(screenSize);

    return {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: config.aspectRatio,
        plugins: {
            legend: {
                display: true,
                position: config.legendPosition,
                labels: {
                    font: { size: config.fontSize.legend },
                    padding: screenSize === 'mobile' ? 8 : 12,
                    usePointStyle: screenSize === 'mobile',
                    color: CHART_COLORS.primary
                }
            },
            title: {
                display: true,
                text: screenSize === 'mobile' ? title.replace(/\s*\([^)]*\)/, '') : title,
                font: { size: config.fontSize.title, weight: 'bold' },
                padding: config.spacing.padding,
                color: CHART_COLORS.primary
            }
        },
        scales: {
            x: {
                grid: {
                    color: CHART_COLORS.grid,
                    borderColor: CHART_COLORS.muted
                },
                ticks: {
                    font: { size: config.fontSize.ticks },
                    maxTicksLimit: config.maxTicksLimit,
                    maxRotation: screenSize === 'mobile' ? 45 : 0,
                    color: CHART_COLORS.muted
                },
                title: {
                    display: screenSize !== 'mobile',
                    text: xAxisLabel,
                    font: { size: config.fontSize.axis },
                    color: CHART_COLORS.primary
                }
            },
            y: {
                grid: {
                    color: CHART_COLORS.grid,
                    borderColor: CHART_COLORS.muted
                },
                min: yMin,
                max: yMax,
                ticks: {
                    font: { size: config.fontSize.ticks },
                    maxTicksLimit: screenSize === 'mobile' ? 6 : 8,
                    color: CHART_COLORS.muted,
                    callback: function (value) {
                        return value.toFixed(screenSize === 'mobile' ? 1 : 2);
                    }
                },
                title: {
                    display: screenSize !== 'mobile',
                    text: yAxisLabel,
                    font: { size: config.fontSize.axis },
                    color: CHART_COLORS.primary
                }
            }
        },
        interaction: { intersect: false, mode: 'index' },
        elements: {
            point: { radius: config.spacing.pointRadius },
            line: { borderWidth: config.spacing.borderWidth }
        }
    };
};

// Create responsive slider component with brand styling
const createSlider = (id, countId, min, max, value, step, label, description) => `
    <div style="margin: 15px 0; padding: 15px; border: 1px solid ${CHART_COLORS.grid}; border-radius: 8px; background-color: ${CHART_COLORS.light};">
        <label for="${id}" style="font-weight: bold; margin-bottom: 10px; display: block; font-size: ${window.innerWidth <= BREAKPOINTS.mobile ? '14px' : '16px'}; color: ${CHART_COLORS.primary};">
            ${label}: <span id="${countId}" style="color: ${CHART_COLORS.accent};">${value}</span>
        </label>
        <input type="range" id="${id}" min="${min}" max="${max}" value="${value}" step="${step}" 
               style="width: 100%; margin: 10px 0; height: 6px; border-radius: 5px; accent-color: ${CHART_COLORS.accent};">
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: ${CHART_COLORS.muted}; margin-top: 5px;">
            <span>${min}</span>
            <span>${Math.floor((min + max) / 2)}</span>
            <span>${max}</span>
        </div>
        <div style="margin-top: 15px; font-size: ${window.innerWidth <= BREAKPOINTS.mobile ? '13px' : '14px'}; color: ${CHART_COLORS.muted}; line-height: 1.4;">
            ${description}
        </div>
    </div>
`;

// ================================================
// File: responsive-power-simulation.js
// ================================================

class PowerSimulation {
    constructor() {
        this.isCalculating = false;
        this.lastResult = null;
        this.updatePlot = debounce(this._updatePlot.bind(this), 150);
        this.handleResize = debounce(this._handleResize.bind(this), 250);
        this.chart = null;

        window.addEventListener('resize', this.handleResize);
    }

    async simulatePowerHierarchical(nCoverslips, nNeuronsPerCoverslip, effectSize = 1.5) {
        const cacheKey = { type: 'power', nCoverslips, nNeuronsPerCoverslip, effectSize };
        const cached = simulationCache.get(cacheKey);
        if (cached) return cached;

        const simulations = 1000;
        const chunkSize = 50;
        let significantResults = 0;

        const coverslipSD = 2.0;
        const neuronSD = 3.0;
        const baseMean = 50;

        for (let chunk = 0; chunk < simulations; chunk += chunkSize) {
            const chunkEnd = Math.min(chunk + chunkSize, simulations);

            for (let sim = chunk; sim < chunkEnd; sim++) {
                const group1Means = new Float32Array(nCoverslips);
                const group2Means = new Float32Array(nCoverslips);

                for (let i = 0; i < nCoverslips; i++) {
                    const coverslip1TrueMean = baseMean + normalRandom(0, coverslipSD);
                    const coverslip2TrueMean = baseMean + (effectSize * coverslipSD) + normalRandom(0, coverslipSD);

                    let sum1 = 0, sum2 = 0;
                    for (let j = 0; j < nNeuronsPerCoverslip; j++) {
                        sum1 += coverslip1TrueMean + normalRandom(0, neuronSD);
                        sum2 += coverslip2TrueMean + normalRandom(0, neuronSD);
                    }

                    group1Means[i] = sum1 / nNeuronsPerCoverslip;
                    group2Means[i] = sum2 / nNeuronsPerCoverslip;
                }

                const mean1 = group1Means.reduce((sum, val) => sum + val, 0) / nCoverslips;
                const mean2 = group2Means.reduce((sum, val) => sum + val, 0) / nCoverslips;

                const var1 = group1Means.reduce((sum, val) => sum + (val - mean1) ** 2, 0) / (nCoverslips - 1);
                const var2 = group2Means.reduce((sum, val) => sum + (val - mean2) ** 2, 0) / (nCoverslips - 1);

                const pooledSE = Math.sqrt((var1 + var2) / nCoverslips);
                const tStat = Math.abs(mean1 - mean2) / pooledSE;
                const criticalValue = getCriticalT(2 * (nCoverslips - 1));

                if (tStat > criticalValue) significantResults++;
            }

            if (chunk + chunkSize < simulations) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const result = significantResults / simulations;
        simulationCache.set(cacheKey, result);
        return result;
    }

    _handleResize() {
        if (this.chart) {
            this.updatePlot();
        }
    }

    async _updatePlot() {
        if (this.isCalculating) return;
        this.isCalculating = true;

        const screenSize = getScreenSize();
        const neuronsPerCoverslip = screenSize === 'mobile' ?
            [5, 15, 25, 35, 50] : [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

        const coverslipCount = parseInt(document.getElementById('power-coverslip-slider').value);
        document.getElementById('power-coverslip-count').textContent = coverslipCount;

        const canvas = document.getElementById('power-simulation');
        const title = `Power vs. Neurons per Coverslip (${coverslipCount} coverslips per group)`;

        if (this.chart) {
            this.chart.options.plugins.title.text = screenSize === 'mobile' ?
                'Power vs. Neurons - Updating...' : title + ' - Updating...';
            this.chart.update('none');
        }

        try {
            const powerValues = await Promise.all(
                neuronsPerCoverslip.map(n => this.simulatePowerHierarchical(coverslipCount, n))
            );

            const ctx = canvas.getContext('2d');
            const config = getResponsiveConfig(screenSize);

            if (this.chart) {
                this.chart.destroy();
            }

            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: neuronsPerCoverslip,
                    datasets: [{
                        label: 'Statistical Power',
                        data: powerValues,
                        borderColor: CHART_COLORS.primary,
                        backgroundColor: `${CHART_COLORS.primary}20`,
                        pointBackgroundColor: CHART_COLORS.primary,
                        pointBorderColor: CHART_COLORS.white,
                        pointBorderWidth: 2,
                        tension: 0.3,
                        fill: false
                    }, {
                        label: screenSize === 'mobile' ? '80% Target' : 'Target Power (80%)',
                        data: neuronsPerCoverslip.map(() => 0.8),
                        borderColor: CHART_COLORS.reference,
                        borderWidth: config.spacing.borderWidth - 1,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        tension: 0,
                        fill: false
                    }]
                },
                options: getChartConfig(
                    title,
                    'Neurons Imaged per Coverslip',
                    'Statistical Power',
                    0, 1
                )
            });

            this.lastResult = { chart: this.chart };

        } catch (error) {
            console.error('Error updating power plot:', error);
        } finally {
            this.isCalculating = false;
        }
    }
}

const powerSim = new PowerSimulation();

const initializePowerSimulation = () => {
    const plotDiv = document.getElementById('power-simulation');
    if (!plotDiv) return;

    const sliderHTML = createSlider(
        'power-coverslip-slider', 'power-coverslip-count',
        1, 20, 3, 1,
        'Coverslips imaged per group',
        '<strong>Key insight:</strong> Effect size uncertainty comes from two sources: (1) true variation between coverslip means, and (2) measurement error from finite neurons. Averaging neurons within coverslips combines both uncertainties, reducing our ability to distinguish biological variation from measurement imprecision.'
    );

    plotDiv.insertAdjacentHTML('beforebegin', sliderHTML);

    const slider = document.getElementById('power-coverslip-slider');
    slider.addEventListener('input', powerSim.updatePlot);

    powerSim.updatePlot();
};

class TypeIErrorSimulation {
    constructor() {
        this.isCalculating = false;
        this.lastResult = null;
        this.updatePlot = debounce(this._updatePlot.bind(this), 150);
        this.handleResize = debounce(this._handleResize.bind(this), 250);
        this.chart = null;

        window.addEventListener('resize', this.handleResize);
    }

    async simulateTypeIError(nCoverslips, nNeuronsPerCoverslip, method = 'pooled') {
        const cacheKey = { type: 'typeI', nCoverslips, nNeuronsPerCoverslip, method };
        const cached = simulationCache.get(cacheKey);
        if (cached) return cached;

        const simulations = 2000;
        const chunkSize = 100;
        let significantResults = 0;

        const coverslipSD = 2.0;
        const neuronSD = 3.0;
        const baseMean = 50;
        const effectSize = 0.0;

        for (let chunk = 0; chunk < simulations; chunk += chunkSize) {
            const chunkEnd = Math.min(chunk + chunkSize, simulations);

            for (let sim = chunk; sim < chunkEnd; sim++) {
                let tStat, criticalValue;

                if (method === 'pooled') {
                    const totalN = nCoverslips * nNeuronsPerCoverslip;
                    const group1Data = new Float32Array(totalN);
                    const group2Data = new Float32Array(totalN);

                    let idx = 0;
                    for (let i = 0; i < nCoverslips; i++) {
                        const coverslip1TrueMean = baseMean + normalRandom(0, coverslipSD);
                        const coverslip2TrueMean = baseMean + effectSize + normalRandom(0, coverslipSD);

                        for (let j = 0; j < nNeuronsPerCoverslip; j++) {
                            group1Data[idx] = coverslip1TrueMean + normalRandom(0, neuronSD);
                            group2Data[idx] = coverslip2TrueMean + normalRandom(0, neuronSD);
                            idx++;
                        }
                    }

                    const mean1 = group1Data.reduce((sum, val) => sum + val, 0) / totalN;
                    const mean2 = group2Data.reduce((sum, val) => sum + val, 0) / totalN;

                    const var1 = group1Data.reduce((sum, val) => sum + (val - mean1) ** 2, 0) / (totalN - 1);
                    const var2 = group2Data.reduce((sum, val) => sum + (val - mean2) ** 2, 0) / (totalN - 1);

                    const pooledSE = Math.sqrt((var1 + var2) / totalN);
                    tStat = Math.abs(mean1 - mean2) / pooledSE;
                    criticalValue = 1.96;

                } else {
                    const group1Means = new Float32Array(nCoverslips);
                    const group2Means = new Float32Array(nCoverslips);

                    for (let i = 0; i < nCoverslips; i++) {
                        const coverslip1TrueMean = baseMean + normalRandom(0, coverslipSD);
                        const coverslip2TrueMean = baseMean + effectSize + normalRandom(0, coverslipSD);

                        let sum1 = 0, sum2 = 0;
                        for (let j = 0; j < nNeuronsPerCoverslip; j++) {
                            sum1 += coverslip1TrueMean + normalRandom(0, neuronSD);
                            sum2 += coverslip2TrueMean + normalRandom(0, neuronSD);
                        }

                        group1Means[i] = sum1 / nNeuronsPerCoverslip;
                        group2Means[i] = sum2 / nNeuronsPerCoverslip;
                    }

                    const mean1 = group1Means.reduce((sum, val) => sum + val, 0) / nCoverslips;
                    const mean2 = group2Means.reduce((sum, val) => sum + val, 0) / nCoverslips;

                    const var1 = group1Means.reduce((sum, val) => sum + (val - mean1) ** 2, 0) / (nCoverslips - 1);
                    const var2 = group2Means.reduce((sum, val) => sum + (val - mean2) ** 2, 0) / (nCoverslips - 1);

                    const pooledSE = Math.sqrt((var1 + var2) / nCoverslips);
                    tStat = Math.abs(mean1 - mean2) / pooledSE;
                    criticalValue = getCriticalT(2 * (nCoverslips - 1));
                }

                if (tStat > criticalValue) significantResults++;
            }

            if (chunk + chunkSize < simulations) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const result = significantResults / simulations;
        simulationCache.set(cacheKey, result);
        return result;
    }

    _handleResize() {
        if (this.chart) {
            this.updatePlot();
        }
    }

    async _updatePlot() {
        if (this.isCalculating) return;
        this.isCalculating = true;

        const neuronsPerCoverslip = parseInt(document.getElementById('type-i-neuron-slider').value);
        document.getElementById('type-i-neuron-count').textContent = neuronsPerCoverslip;

        const screenSize = getScreenSize();
        const coverslipCounts = screenSize === 'mobile' ? [3, 5, 8, 10] : [3, 4, 5, 6, 8, 10];
        const canvas = document.getElementById('type-i-error-plot');
        const title = `False Positive Rate is Uncontrolled if Neurons are Treated as Independent (${neuronsPerCoverslip} neurons per coverslip)`;

        if (this.chart) {
            this.chart.options.plugins.title.text = screenSize === 'mobile' ?
                'False Positive Rate - Updating...' : title + ' - Updating...';
            this.chart.update('none');
        }

        try {
            const [pooledErrors, hierarchicalErrors] = await Promise.all([
                Promise.all(coverslipCounts.map(n => this.simulateTypeIError(n, neuronsPerCoverslip, 'pooled'))),
                Promise.all(coverslipCounts.map(n => this.simulateTypeIError(n, neuronsPerCoverslip, 'hierarchical')))
            ]);

            const ctx = canvas.getContext('2d');
            const config = getResponsiveConfig(screenSize);

            if (this.chart) {
                this.chart.destroy();
            }

            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: coverslipCounts,
                    datasets: [{
                        label: screenSize === 'mobile' ? 'Pool All' : 'Option 1: Pool All Neurons',
                        data: pooledErrors,
                        borderColor: CHART_COLORS.error,
                        backgroundColor: `${CHART_COLORS.error}20`,
                        pointBackgroundColor: CHART_COLORS.error,
                        pointBorderColor: CHART_COLORS.white,
                        pointBorderWidth: 2,
                        tension: 0.3,
                        fill: false
                    }, {
                        label: screenSize === 'mobile' ? 'Hierarchical' : 'Option 2: Hierarchical Analysis',
                        data: hierarchicalErrors,
                        borderColor: CHART_COLORS.success,
                        backgroundColor: `${CHART_COLORS.success}20`,
                        pointBackgroundColor: CHART_COLORS.success,
                        pointBorderColor: CHART_COLORS.white,
                        pointBorderWidth: 2,
                        tension: 0.3,
                        fill: false
                    }, {
                        label: screenSize === 'mobile' ? 'Expected 5%' : 'Expected (α = 0.05)',
                        data: coverslipCounts.map(() => 0.05),
                        borderColor: CHART_COLORS.reference,
                        borderWidth: config.spacing.borderWidth - 1,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        tension: 0,
                        fill: false
                    }]
                },
                options: getChartConfig(
                    title,
                    'Number of Coverslips per Group',
                    'Type I Error Rate (False Positive Rate)',
                    0, 0.6
                )
            });

            this.lastResult = { chart: this.chart };

        } catch (error) {
            console.error('Error updating Type I error plot:', error);
        } finally {
            this.isCalculating = false;
        }
    }
}

const typeIErrorSim = new TypeIErrorSimulation();

const initializeTypeIErrorSimulation = () => {
    const plotDiv = document.getElementById('type-i-error-plot');
    if (!plotDiv) return;

    const sliderHTML = createSlider(
        'type-i-neuron-slider', 'type-i-neuron-count',
        3, 20, 20, 1,
        'Neurons imaged per coverslip',
        '<strong>This simulation shows why pooling is wrong:</strong> When there\'s no true effect (effect size = 0), we should reject the null hypothesis only 5% of the time (dashed line). The pooled approach treats correlated observations as independent, dramatically inflating false positive rates. More neurons per coverslip makes this problem <em>worse</em>.'
    );

    plotDiv.insertAdjacentHTML('beforebegin', sliderHTML);

    const slider = document.getElementById('type-i-neuron-slider');
    slider.addEventListener('input', typeIErrorSim.updatePlot);

    typeIErrorSim.updatePlot();
};