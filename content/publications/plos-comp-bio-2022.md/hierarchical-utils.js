// ================================================
// File: hierarchical-utils.js
// ================================================

// Pre-computed critical t-values (expanded table)
const CRITICAL_T_VALUES = new Map([
    [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447],
    [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228], [11, 2.201],
    [12, 2.179], [13, 2.160], [14, 2.145], [15, 2.131], [16, 2.120],
    [17, 2.110], [18, 2.101], [19, 2.093], [20, 2.086], [30, 2.042],
    [40, 2.021], [50, 2.009], [100, 1.984], [Infinity, 1.96]
]);

const getCriticalT = (df) => {
    // Direct lookup first
    if (CRITICAL_T_VALUES.has(df)) {
        return CRITICAL_T_VALUES.get(df);
    }

    const keys = [...CRITICAL_T_VALUES.keys()].sort((a, b) => a - b);

    // Find bracketing values
    let lowerKey = null, upperKey = null;
    for (let i = 0; i < keys.length - 1; i++) {
        if (keys[i] <= df && keys[i + 1] >= df) {
            lowerKey = keys[i];
            upperKey = keys[i + 1];
            break;
        }
    }

    // Handle edge cases
    if (lowerKey === null) {
        return CRITICAL_T_VALUES.get(keys[0]); // Use smallest available
    }
    if (upperKey === null || upperKey === Infinity) {
        return 1.96; // For large df
    }

    // Linear interpolation
    const lowerVal = CRITICAL_T_VALUES.get(lowerKey);
    const upperVal = CRITICAL_T_VALUES.get(upperKey);
    const fraction = (df - lowerKey) / (upperKey - lowerKey);

    return lowerVal + fraction * (upperVal - lowerVal);
};

// Optimized Box-Muller with cached values
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

// Memoization for simulation results
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
            this.cache.set(key, item); // Move to end (LRU)
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

// Debounced function executor
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

// Create optimized slider component
const createSlider = (id, countId, min, max, value, step, label, description) => `
    <div style="margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <label for="${id}" style="font-weight: bold; margin-bottom: 10px; display: block;">
            ${label}: <span id="${countId}">${value}</span>
        </label>
        <input type="range" id="${id}" min="${min}" max="${max}" value="${value}" step="${step}" 
               style="width: 100%; margin: 10px 0; height: 6px; border-radius: 5px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #666; margin-top: 5px;">
            <span>${min}</span>
            <span>${Math.floor((min + max) / 2)}</span>
            <span>${max}</span>
        </div>
        <div style="margin-top: 15px; font-size: 14px; color: #555; line-height: 1.4;">
            ${description}
        </div>
    </div>
`;

// Common Chart.js configuration
const getChartConfig = () => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
        legend: {
            display: true,
            position: 'top'
        }
    },
    scales: {
        x: {
            grid: {
                color: '#e8e8e8'
            },
            ticks: {
                font: {
                    size: 12
                }
            },
            title: {
                display: true,
                font: {
                    size: 14
                }
            }
        },
        y: {
            grid: {
                color: '#e8e8e8'
            },
            ticks: {
                font: {
                    size: 12
                }
            },
            title: {
                display: true,
                font: {
                    size: 14
                }
            }
        }
    },
    interaction: {
        intersect: false,
        mode: 'index'
    }
});

// ================================================
// File: power-simulation.js
// ================================================

class PowerSimulation {
    constructor() {
        this.isCalculating = false;
        this.lastResult = null;
        this.updatePlot = debounce(this._updatePlot.bind(this), 150);
        this.chart = null;
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

                // Vectorized coverslip mean generation
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

                // Optimized statistical calculations
                const mean1 = group1Means.reduce((sum, val) => sum + val, 0) / nCoverslips;
                const mean2 = group2Means.reduce((sum, val) => sum + val, 0) / nCoverslips;

                const var1 = group1Means.reduce((sum, val) => sum + (val - mean1) ** 2, 0) / (nCoverslips - 1);
                const var2 = group2Means.reduce((sum, val) => sum + (val - mean2) ** 2, 0) / (nCoverslips - 1);

                const pooledSE = Math.sqrt((var1 + var2) / nCoverslips);
                const tStat = Math.abs(mean1 - mean2) / pooledSE;
                const criticalValue = getCriticalT(2 * (nCoverslips - 1));

                if (tStat > criticalValue) significantResults++;
            }

            // Non-blocking yield
            if (chunk + chunkSize < simulations) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const result = significantResults / simulations;
        simulationCache.set(cacheKey, result);
        return result;
    }

    async _updatePlot() {
        if (this.isCalculating) return;
        this.isCalculating = true;

        const neuronsPerCoverslip = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
        const coverslipCount = parseInt(document.getElementById('power-coverslip-slider').value);
        document.getElementById('power-coverslip-count').textContent = coverslipCount;

        const canvas = document.getElementById('power-simulation');

        // Show loading state
        if (this.chart) {
            this.chart.options.plugins.title.text = `Power vs. Neurons per Coverslip (${coverslipCount} coverslips per group) - Updating...`;
            this.chart.update('none');
        }

        try {
            const powerValues = await Promise.all(
                neuronsPerCoverslip.map(n => this.simulatePowerHierarchical(coverslipCount, n))
            );

            const ctx = canvas.getContext('2d');

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
                        borderColor: '#1f77b4',
                        backgroundColor: 'rgba(31, 119, 180, 0.1)',
                        borderWidth: 3,
                        pointBackgroundColor: '#1f77b4',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 6,
                        tension: 0.3,
                        fill: false
                    }, {
                        label: 'Target Power (80%)',
                        data: neuronsPerCoverslip.map(() => 0.8),
                        borderColor: 'rgba(127,127,127,0.8)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        tension: 0,
                        fill: false
                    }]
                },
                options: {
                    ...getChartConfig(),
                    plugins: {
                        ...getChartConfig().plugins,
                        title: {
                            display: true,
                            text: `Power vs. Neurons per Coverslip (${coverslipCount} coverslips per group)`,
                            font: {
                                size: 16,
                                family: 'Arial, sans-serif'
                            }
                        }
                    },
                    scales: {
                        ...getChartConfig().scales,
                        x: {
                            ...getChartConfig().scales.x,
                            title: {
                                ...getChartConfig().scales.x.title,
                                text: 'Neurons Imaged per Coverslip'
                            },
                            min: 0,
                            max: 55,
                            ticks: {
                                ...getChartConfig().scales.x.ticks,
                                stepSize: 5
                            }
                        },
                        y: {
                            ...getChartConfig().scales.y,
                            title: {
                                ...getChartConfig().scales.y.title,
                                text: 'Statistical Power'
                            },
                            min: 0,
                            max: 1,
                            ticks: {
                                ...getChartConfig().scales.y.ticks,
                                callback: function (value) {
                                    return value.toFixed(2);
                                }
                            }
                        }
                    }
                }
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
        '<strong>Key insight:</strong> Our effect size estimate has uncertainty from two sources: (1) true variation between coverslip means within each group, and (2) measurement error in estimating each coverslip mean from finite neurons. By averaging neurons within coverslips, we roll both sources of uncertainty into a single number, reducing our ability to distinguish true biological variation from measurement imprecision.'
    );

    plotDiv.insertAdjacentHTML('beforebegin', sliderHTML);

    const slider = document.getElementById('power-coverslip-slider');
    slider.addEventListener('input', powerSim.updatePlot);

    // Initial plot
    powerSim.updatePlot();
};

class TypeIErrorSimulation {
    constructor() {
        this.isCalculating = false;
        this.lastResult = null;
        this.updatePlot = debounce(this._updatePlot.bind(this), 150);
        this.chart = null;
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

                    // Optimized statistics with reduce
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

    async _updatePlot() {
        if (this.isCalculating) return;
        this.isCalculating = true;

        const neuronsPerCoverslip = parseInt(document.getElementById('type-i-neuron-slider').value);
        document.getElementById('type-i-neuron-count').textContent = neuronsPerCoverslip;

        const coverslipCounts = [3, 4, 5, 6, 8, 10];
        const canvas = document.getElementById('type-i-error-plot');

        if (this.chart) {
            this.chart.options.plugins.title.text = `Type I Error Rate (${neuronsPerCoverslip} neurons per coverslip) - Updating...`;
            this.chart.update('none');
        }

        try {
            const [pooledErrors, hierarchicalErrors] = await Promise.all([
                Promise.all(coverslipCounts.map(n => this.simulateTypeIError(n, neuronsPerCoverslip, 'pooled'))),
                Promise.all(coverslipCounts.map(n => this.simulateTypeIError(n, neuronsPerCoverslip, 'hierarchical')))
            ]);

            const ctx = canvas.getContext('2d');

            if (this.chart) {
                this.chart.destroy();
            }

            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: coverslipCounts,
                    datasets: [{
                        label: 'Option 1: Pool All Neurons',
                        data: pooledErrors,
                        borderColor: '#d62728',
                        backgroundColor: 'rgba(214, 39, 40, 0.1)',
                        borderWidth: 3,
                        pointBackgroundColor: '#d62728',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 6,
                        tension: 0.3,
                        fill: false
                    }, {
                        label: 'Option 2: Hierarchical Analysis',
                        data: hierarchicalErrors,
                        borderColor: '#1f77b4',
                        backgroundColor: 'rgba(31, 119, 180, 0.1)',
                        borderWidth: 3,
                        pointBackgroundColor: '#1f77b4',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 6,
                        tension: 0.3,
                        fill: false
                    }, {
                        label: 'Expected (α = 0.05)',
                        data: coverslipCounts.map(() => 0.05),
                        borderColor: 'rgba(127,127,127,0.8)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        tension: 0,
                        fill: false
                    }]
                },
                options: {
                    ...getChartConfig(),
                    plugins: {
                        ...getChartConfig().plugins,
                        title: {
                            display: true,
                            text: `False Positive Rate is Uncontrolled if Neurons are Treated as Independent (${neuronsPerCoverslip} neurons per coverslip)`,
                            font: {
                                size: 16,
                                family: 'Arial, sans-serif'
                            }
                        }
                    },
                    scales: {
                        ...getChartConfig().scales,
                        x: {
                            ...getChartConfig().scales.x,
                            title: {
                                ...getChartConfig().scales.x.title,
                                text: 'Number of Coverslips per Group'
                            },
                            min: 0,
                            max: 15,
                            ticks: {
                                ...getChartConfig().scales.x.ticks,
                                stepSize: 1
                            }
                        },
                        y: {
                            ...getChartConfig().scales.y,
                            title: {
                                ...getChartConfig().scales.y.title,
                                text: 'Type I Error Rate (False Positive Rate)'
                            },
                            min: 0,
                            max: 0.6,
                            ticks: {
                                ...getChartConfig().scales.y.ticks,
                                callback: function (value) {
                                    return value.toFixed(3);
                                }
                            }
                        }
                    }
                }
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
        '<strong>This simulation shows why pooling is wrong:</strong> When there\'s no true effect (effect size = 0), we should reject the null hypothesis only 5% of the time (dashed line). The pooled approach treats correlated observations as independent, dramatically inflating false positive rates. More neurons per coverslip makes this problem <em>worse</em> because it increases the apparent sample size without adding truly independent observations.'
    );

    plotDiv.insertAdjacentHTML('beforebegin', sliderHTML);

    const slider = document.getElementById('type-i-neuron-slider');
    slider.addEventListener('input', typeIErrorSim.updatePlot);

    // Initial plot
    typeIErrorSim.updatePlot();
};