var map = L.map('map').setView([38.2682, 140.8694], 11);
L.tileLayer('https://tile.openstreetmap.jp/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

var geojsonLayer = null, currentTargetFeature = null, hintedLayer = null;
var score = 0, totalQuestions = 10, currentCount = 0, currentFilteredFeatures = [];
var solvedFeatures = new Set(), featureToLayerMap = new Map(), labelLayers = [];
var previewMap = null, previewLayer = null;
var gameConfig = { mode: 'count', count: 10, ward: 'ALL', hoverLabel: true };

var placedLabelBoxes = [];

function getWardColor(w) {
    if (!w) return '#ccc';
    if (w.includes('青葉区')) return '#337ab7';
    if (w.includes('太白区')) return '#5cb85c';
    if (w.includes('宮城野区')) return '#f0ad4e';
    if (w.includes('若林区')) return '#d9534f';
    if (w.includes('泉区')) return '#9467bd';
    return '#17becf';
}

function onGameModeChange() {
    var val = document.getElementById('game-mode').value;
    document.getElementById('setting-count').style.display = (val === 'count') ? 'block' : 'none';
    document.getElementById('setting-ward').style.display = (val === 'ward-all') ? 'block' : 'none';
}

function returnToMenu() {
    document.getElementById('quiz-panel').style.display = 'none';
    document.getElementById('menu-panel').style.display = 'block';
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    clearLabels();
    solvedFeatures.clear();
    hintedLayer = null;
    currentTargetFeature = null;
}

function toggleHoverLabel() {
    gameConfig.hoverLabel = document.getElementById('quiz-hover-toggle').checked;
    redrawMap(false);
}

function startGame() {
    if (typeof allData === 'undefined' || !allData) {
        alert('地図データ（r2ka04.js）が読み込まれていません。');
        return;
    }
    gameConfig.mode = document.getElementById('game-mode').value;
    gameConfig.hoverLabel = document.getElementById('quiz-hover-toggle').checked;
    
    if (gameConfig.mode === 'count') {
        gameConfig.count = parseInt(document.getElementById('question-count-select').value);
        gameConfig.ward = 'ALL';
        document.getElementById('game-mode-title').innerText = `問題数モード (${gameConfig.count}問)`;
    } else if (gameConfig.mode === 'ward-all') {
        gameConfig.ward = document.getElementById('target-ward-select').value;
        document.getElementById('game-mode-title').innerText = `全問制覇 (${gameConfig.ward})`;
    } else if (gameConfig.mode === 'city-all') {
        gameConfig.ward = 'ALL';
        document.getElementById('game-mode-title').innerText = `全問制覇 (仙台市全域)`;
    } else if (gameConfig.mode === 'explore') {
        gameConfig.ward = 'ALL';
        document.getElementById('game-mode-title').innerText = `探索モード（全地名表示）`;
    }

    score = 0; currentCount = 0; solvedFeatures.clear();
    hintedLayer = null;
    document.getElementById('feedback-msg').innerText = "";
    
    updateFilteredFeatures();
    
    if (gameConfig.mode === 'ward-all' || gameConfig.mode === 'city-all') {
        totalQuestions = currentFilteredFeatures.length;
    } else {
        totalQuestions = gameConfig.count;
    }

    document.getElementById('menu-panel').style.display = 'none';
    
    if (gameConfig.mode === 'explore') {
        document.getElementById('quiz-panel').style.display = 'block';
        document.getElementById('quiz-ui-box').style.display = 'none';
    } else {
        document.getElementById('quiz-panel').style.display = 'block';
        document.getElementById('quiz-ui-box').style.display = 'block';
    }

    redrawMap(true);
    if (gameConfig.mode !== 'explore') {
        nextQuiz();
    }
}

function updateFilteredFeatures() {
    var sw = gameConfig.ward;
    currentFilteredFeatures = allData.features.filter(f => {
        if (!f.properties || !f.properties.S_NAME) return false;
        if (sw === 'ALL') return true;
        return f.properties.CITY_NAME && f.properties.CITY_NAME.includes(sw);
    });
}

function clearLabels() {
    labelLayers.forEach(l => map.removeLayer(l));
    labelLayers = [];
    placedLabelBoxes = [];
}

function addLabel(feature, layer, force = false) {
    if (gameConfig.mode !== 'explore' && !solvedFeatures.has(feature) && !force) return;
    var name = feature.properties && feature.properties.S_NAME;
    if (!name) return;

    try {
        var bounds = layer.getBounds();
        if (!bounds || !bounds.isValid()) return;
        var center = bounds.getCenter();
        if (isNaN(center.lat) || isNaN(center.lng)) return;

        var centerPoint = map.latLngToLayerPoint(center);
        var nePixel = map.latLngToLayerPoint(bounds.getNorthEast());
        var swPixel = map.latLngToLayerPoint(bounds.getSouthWest());
        var widthPx = Math.abs(nePixel.x - swPixel.x);
        var heightPx = Math.abs(nePixel.y - swPixel.y);

        if (widthPx < 18 || heightPx < 12) return;

        var calculatedSize = Math.floor(widthPx / (name.length * 0.7));
        var z = map.getZoom();
        var maxAllowedSize = (z <= 13) ? 9 : (z <= 15 ? 12 : 18);
        var minAllowedSize = 7;
        var finalFontSize = Math.min(Math.max(calculatedSize, minAllowedSize), maxAllowedSize);

        var labelBoxWidth = name.length * finalFontSize * 0.7;
        var labelBoxHeight = finalFontSize + 4;
        
        for (var box of placedLabelBoxes) {
            var dx = Math.abs(centerPoint.x - box.x);
            var dy = Math.abs(centerPoint.y - box.y);
            if (dx < (labelBoxWidth + box.w) / 2 && dy < (labelBoxHeight + box.h) / 2) {
                return;
            }
        }

        placedLabelBoxes.push({ x: centerPoint.x, y: centerPoint.y, w: labelBoxWidth, h: labelBoxHeight });

        var marker = L.marker(center, {
            icon: L.divIcon({ 
                className: 'map-label', 
                html: `<span style="font-size: ${finalFontSize}px;">${name}</span>`, 
                iconSize: [labelBoxWidth, labelBoxHeight], 
                iconAnchor: [labelBoxWidth / 2, labelBoxHeight / 2] 
            }),
            interactive: false
        }).addTo(map);
        labelLayers.push(marker);
    } catch (e) {}
}

map.on('zoomend', function() {
    clearLabels();
    if (geojsonLayer && allData) {
        geojsonLayer.eachLayer(function(layer) {
            if (solvedFeatures.has(layer.feature) || gameConfig.mode === 'explore') {
                addLabel(layer.feature, layer, true);
            }
        });
    }
    reapplyHintStyle();
});

function redrawMap(fit = false) {
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    featureToLayerMap.clear(); clearLabels();

    if (typeof allData === 'undefined' || !allData || !allData.features) return;
    var sw = gameConfig.ward;

    geojsonLayer = L.geoJSON(allData, {
        style: function(f) {
            var w = f.properties && f.properties.CITY_NAME;
            var isTarget = (sw === 'ALL' || (w && w.includes(sw)));
            var solved = solvedFeatures.has(f);
            var isExplore = (gameConfig.mode === 'explore');

            return {
                color: isTarget ? '#444' : '#ddd',
                weight: isTarget ? 1 : 0.5,
                fillColor: getWardColor(w),
                fillOpacity: (solved || isExplore) ? 0.75 : (isTarget ? 0.4 : 0.1)
            };
        },
        onEachFeature: function(f, layer) {
            if (!f.properties || !f.properties.S_NAME) return;
            var name = f.properties.S_NAME;
            featureToLayerMap.set(f, layer);

            if (solvedFeatures.has(f) || gameConfig.mode === 'explore') {
                addLabel(f, layer, true);
            }

            if (gameConfig.hoverLabel) {
                layer.bindTooltip(name, {
                    direction: 'right', offset: [10, 0], opacity: 0.95, className: 'map-label'
                });
            }

            layer.on({
                mouseover: function(e) {
                    if (e.target !== hintedLayer && !solvedFeatures.has(f) && gameConfig.mode !== 'explore') {
                        e.target.setStyle({ fillOpacity: 0.8, weight: 2, color: '#fff' });
                    }
                },
                mouseout: function(e) {
                    if (e.target !== hintedLayer && !solvedFeatures.has(f) && gameConfig.mode !== 'explore') {
                        geojsonLayer.resetStyle(e.target);
                    }
                },
                click: function(e) {
                    if (gameConfig.mode === 'explore') return;
                    if (!currentTargetFeature || solvedFeatures.has(f)) return;

                    if (name === currentTargetFeature.properties.S_NAME) {
                        document.getElementById('feedback-msg').innerText = "";
                        score++;
                        solvedFeatures.add(currentTargetFeature);
                        if (e.target._path) e.target._path.classList.remove('glow-hint');
                        e.target.setStyle({ color: '#333', weight: 1, fillColor: getWardColor(currentTargetFeature.properties.CITY_NAME), fillOpacity: 0.75 });
                        addLabel(currentTargetFeature, e.target, true);
                        showSuccessEffect();
                        hintedLayer = null;
                        nextQuiz();
                    } else {
                        document.getElementById('feedback-msg').innerText = `ここは「${name}」だよ`;
                    }
                }
            });
        }
    }).addTo(map);

    reapplyHintStyle();

    if (fit) {
        try {
            if (sw !== 'ALL') {
                var bl = L.featureGroup(geojsonLayer.getLayers().filter(l => l.feature && l.feature.properties && l.feature.properties.CITY_NAME && l.feature.properties.CITY_NAME.includes(sw)));
                if (bl.getLayers().length > 0) map.fitBounds(bl.getBounds());
            } else {
                map.fitBounds(geojsonLayer.getBounds());
            }
        } catch (e) {}
    }
}

function reapplyHintStyle() {
    if (!currentTargetFeature) return;
    var layer = featureToLayerMap.get(currentTargetFeature);
    if (layer) {
        hintedLayer = layer;
        layer.setStyle({ fillColor: '#ff5722', color: '#e91e63', weight: 3 });
        setTimeout(() => { 
            if (layer._path && !layer._path.classList.contains('glow-hint')) {
                layer._path.classList.add('glow-hint');
            } 
        }, 10);
    }
}

function showSuccessEffect() {
    var p = document.getElementById('success-popup');
    p.classList.add('show');
    setTimeout(() => p.classList.remove('show'), 600);
}

function nextQuiz() {
    if (gameConfig.mode === 'explore') return;

    if (hintedLayer) {
        if (hintedLayer._path) hintedLayer._path.classList.remove('glow-hint');
        if (!solvedFeatures.has(hintedLayer.feature)) {
            geojsonLayer.resetStyle(hintedLayer);
        } else {
            hintedLayer.setStyle({
                color: '#333', weight: 1,
                fillColor: getWardColor(hintedLayer.feature.properties.CITY_NAME),
                fillOpacity: 0.75
            });
        }
        hintedLayer = null;
    }

    if (currentFilteredFeatures.length === 0) return;

    var unsolved = currentFilteredFeatures.filter(f => !solvedFeatures.has(f));
    
    if (currentCount >= totalQuestions || unsolved.length === 0) {
        alert(`ゲームクリア！スコア: ${score} / ${totalQuestions}`);
        returnToMenu();
        return;
    }

    currentCount++;
    document.getElementById('score').innerText = `正解数: ${score} (${currentCount}/${totalQuestions})`;

    currentTargetFeature = unsolved[Math.floor(Math.random() * unsolved.length)];
    document.getElementById('target-name').innerText = currentTargetFeature.properties.S_NAME;
    document.getElementById('target-ward').innerText = `（${currentTargetFeature.properties.CITY_NAME || ''}）`;

    setTimeout(() => {
        if (!previewMap) {
            previewMap = L.map('shape-preview', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
        }
        if (previewLayer) previewMap.removeLayer(previewLayer);
        try {
            previewLayer = L.geoJSON(currentTargetFeature, { 
                style: { color: '#333', weight: 2, fillColor: getWardColor(currentTargetFeature.properties.CITY_NAME), fillOpacity: 0.85 } 
            }).addTo(previewMap);
            previewMap.invalidateSize();
            previewMap.fitBounds(previewLayer.getBounds(), { padding: [10, 10] });
        } catch (e) {}
    }, 50);
}

function showHint() {
    if (!currentTargetFeature) return;

    if (hintedLayer && !solvedFeatures.has(hintedLayer.feature)) {
        if (hintedLayer._path) hintedLayer._path.classList.remove('glow-hint');
        geojsonLayer.resetStyle(hintedLayer);
    }

    var layer = featureToLayerMap.get(currentTargetFeature);
    if (layer) {
        hintedLayer = layer;
        layer.setStyle({ fillColor: '#ff5722', color: '#e91e63', weight: 3 });
        setTimeout(() => { 
            if (layer._path) layer._path.classList.add('glow-hint'); 
        }, 10);
        
        try {
            var bounds = layer.getBounds();
            if (bounds && bounds.isValid()) {
                map.setView(bounds.getCenter(), map.getZoom());
            }
        } catch (e) {}
    }
}