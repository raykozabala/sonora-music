/**
 * Sonora Music — Audio Visualizers
 * High-performance Canvas 2D visualization suite
 * 
 * Features:
 * - 4 rendering engines: Wave, Circular, Particle, and 3D Perspective Bar
 * - Web Audio AnalyserNode integration with fallback synthetic spectrum
 * - Smooth frame interpolation (non-jittery 60fps)
 * - Dynamic theme color binding via CSS custom properties
 * - High-DPI (Retina) mobile display support
 * - Automatic pause on background/hidden tabs to preserve battery
 * - Memory leak prevention with full lifecycle cleanup
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  // Core Canvas State
  var _canvas = null;
  var _ctx = null;
  var _currentType = 'wave'; // 'wave' | 'circular' | 'particle' | 'bar' | 'none'
  var _rafId = null;
  var _isRunning = false;
  var _resizeObserver = null;
  var _customColorScheme = null;

  // Logical dimensions
  var _width = 300;
  var _height = 200;
  var _dpr = 1;

  // Audio spectrum buffers
  var SPECTRUM_SIZE = 128;
  var _freqData = new Uint8Array(SPECTRUM_SIZE);

  // Smooth interpolation arrays
  var _smoothedWave = new Float32Array(64);
  var _smoothedBar = new Float32Array(32);
  var _peakHoldBar = new Float32Array(32);
  var _peakSpeedBar = new Float32Array(32);

  // Engine state variables
  var _circularRotation = 0;
  var _circularParticles = [];
  var _particleList = [];
  var _lastBeatTime = 0;
  var _simulatedTime = 0;

  /**
   * Convert HEX color string to RGBA string
   */
  function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== 'string') return 'rgba(255, 71, 87, ' + alpha + ')';
    var clean = hex.trim().replace('#', '');
    if (clean.length === 3) {
      clean = clean.charAt(0) + clean.charAt(0) +
              clean.charAt(1) + clean.charAt(1) +
              clean.charAt(2) + clean.charAt(2);
    }
    if (clean.length !== 6) return 'rgba(255, 71, 87, ' + alpha + ')';

    var r = parseInt(clean.substring(0, 2), 16) || 0;
    var g = parseInt(clean.substring(2, 4), 16) || 0;
    var b = parseInt(clean.substring(4, 6), 16) || 0;
    var a = (typeof alpha === 'number') ? alpha : 1.0;

    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
  }

  /**
   * Retrieve active theme colors from CSS variables or custom scheme
   */
  function getColors() {
    if (_customColorScheme && Array.isArray(_customColorScheme) && _customColorScheme.length >= 2) {
      return {
        primary: _customColorScheme[0],
        secondary: _customColorScheme[1],
        tertiary: _customColorScheme[2] || _customColorScheme[0]
      };
    }

    try {
      var computed = window.getComputedStyle ? getComputedStyle(document.documentElement) : null;
      var prim = (computed && computed.getPropertyValue('--color-primary').trim()) || '#FF4757';
      var sec = (computed && computed.getPropertyValue('--color-secondary').trim()) || '#FF6B35';
      var tert = (computed && computed.getPropertyValue('--color-tertiary').trim()) || '#FF3E2E';
      return { primary: prim, secondary: sec, tertiary: tert };
    } catch (e) {
      return { primary: '#FF4757', secondary: '#FF6B35', tertiary: '#FF3E2E' };
    }
  }

  /**
   * Fetch frequency data from Sonora.Player or generate smooth simulated data
   */
  function updateFrequencyData() {
    var analyser = null;
    try {
      if (Sonora.Player && typeof Sonora.Player.getAnalyser === 'function') {
        analyser = Sonora.Player.getAnalyser();
      }
    } catch (e) {
      analyser = null;
    }

    var isPlaying = false;
    try {
      if (Sonora.Player && typeof Sonora.Player.isPlaying === 'function') {
        isPlaying = Sonora.Player.isPlaying();
      }
    } catch (e) {
      isPlaying = false;
    }

    var hasAudioData = false;
    if (analyser) {
      try {
        analyser.getByteFrequencyData(_freqData);
        // Check if there is actual non-zero audio activity
        for (var i = 0; i < 32; i++) {
          if (_freqData[i] > 2) {
            hasAudioData = true;
            break;
          }
        }
      } catch (err) {
        hasAudioData = false;
      }
    }

    // Fallback: Generate procedural simulated frequency spectrum
    if (!hasAudioData) {
      // Ritmo más lento y amplitudes más bajas: antes el "bajo" estaba casi
      // siempre al máximo y disparaba estallidos y acelerones constantes.
      _simulatedTime += 0.018;
      for (var j = 0; j < SPECTRUM_SIZE; j++) {
        if (isPlaying) {
          var slow = Math.sin(_simulatedTime * 0.8 + j * 0.12);
          var mid = Math.sin(_simulatedTime * 1.7 + j * 0.28);
          var fast = Math.cos(_simulatedTime * 2.9 + j * 0.5);
          var falloff = Math.max(0.15, 1 - (j / SPECTRUM_SIZE) * 0.75);
          var amp = ((slow * 0.5 + mid * 0.35 + fast * 0.15 + 1) * 82) * falloff;
          _freqData[j] = Math.max(0, Math.min(255, Math.floor(amp)));
        } else {
          // Subtle resting ambient pulse when paused
          var idleVal = (Math.sin(_simulatedTime * 0.3 + j * 0.1) * 5) + 8;
          _freqData[j] = Math.max(0, Math.floor(idleVal));
        }
      }
    }
  }

  /**
   * Calculate average bass energy (0.0 to 1.0)
   */
  function getBassEnergy() {
    var sum = 0;
    var count = 8;
    for (var i = 0; i < count; i++) {
      sum += _freqData[i];
    }
    return sum / (count * 255);
  }

  /**
   * Helper: Draw a bar with rounded top and square bottom
   */
  function drawRoundedBar(ctx, x, y, width, height, radius) {
    if (height <= 0 || width <= 0) return;
    var r = Math.min(radius, width / 2, height);
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height);
    ctx.closePath();
    ctx.fill();
  }

  // ==========================================
  // Visualizer 1: Wave Visualizer ('wave')
  // ==========================================
  function renderWave(colors) {
    var numBars = 64;
    var baselineY = _height * 0.72;
    var maxBarHeight = baselineY * 0.88;
    var barStep = _width / numBars;
    var barWidth = Math.max(2, barStep - 2);

    // Clear canvas
    _ctx.clearRect(0, 0, _width, _height);

    for (var i = 0; i < numBars; i++) {
      // Map bar index to frequency bins with exponential weighting toward bass/mids
      var binIndex = Math.min(SPECTRUM_SIZE - 1, Math.floor(Math.pow(i / numBars, 1.25) * 80));
      var targetHeight = (_freqData[binIndex] / 255) * maxBarHeight;

      // Smooth interpolation between frames
      _smoothedWave[i] += (targetHeight - _smoothedWave[i]) * 0.22;
      var barH = Math.max(2, _smoothedWave[i]);
      var x = i * barStep + 1;
      var y = baselineY - barH;

      // Vertical gradient from primary (top) to secondary (bottom)
      var grad = _ctx.createLinearGradient(0, y, 0, baselineY);
      grad.addColorStop(0, colors.primary);
      grad.addColorStop(1, colors.secondary);

      _ctx.save();
      // Glow effect at bar top
      if (barH > 8) {
        _ctx.shadowBlur = 8;
        _ctx.shadowColor = hexToRgba(colors.primary, 0.6);
      }
      _ctx.fillStyle = grad;
      drawRoundedBar(_ctx, x, y, barWidth, barH, barWidth / 2);
      _ctx.restore();

      // Subtle reflection below baseline (mirrored and faded)
      var reflHeight = barH * 0.35;
      var reflY = baselineY + 1;
      var reflGrad = _ctx.createLinearGradient(0, reflY, 0, reflY + reflHeight);
      reflGrad.addColorStop(0, hexToRgba(colors.primary, 0.22));
      reflGrad.addColorStop(1, hexToRgba(colors.secondary, 0.0));

      _ctx.fillStyle = reflGrad;
      _ctx.fillRect(x, reflY, barWidth, reflHeight);
    }
  }

  // ==========================================
  // Visualizer 2: Circular Visualizer ('circular')
  // ==========================================
  function renderCircular(colors) {
    var cx = _width / 2;
    var cy = _height / 2;
    var maxRadius = Math.min(cx, cy);
    var baseRadius = maxRadius * 0.38;
    var bass = getBassEnergy();

    _ctx.clearRect(0, 0, _width, _height);

    // 1. Center pulsing glow driven by bass
    var glowRadius = baseRadius * (0.6 + bass * 0.4);
    var radialGlow = _ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    radialGlow.addColorStop(0, hexToRgba(colors.primary, 0.45 * bass + 0.15));
    radialGlow.addColorStop(0.7, hexToRgba(colors.secondary, 0.2 * bass + 0.05));
    radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');

    _ctx.fillStyle = radialGlow;
    _ctx.beginPath();
    _ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
    _ctx.fill();

    // 2. Slow rotation (~0.5 deg/frame)
    _circularRotation = (_circularRotation + 0.0087) % (Math.PI * 2);

    // 3. Concentric rings around center
    _ctx.strokeStyle = hexToRgba(colors.tertiary, 0.25 + bass * 0.2);
    _ctx.lineWidth = 1.5;
    _ctx.beginPath();
    _ctx.arc(cx, cy, baseRadius * 0.72, 0, Math.PI * 2);
    _ctx.stroke();

    _ctx.strokeStyle = hexToRgba(colors.primary, 0.4 + bass * 0.3);
    _ctx.lineWidth = 2;
    _ctx.beginPath();
    _ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    _ctx.stroke();

    // 4. Ring segments expand/contract based on frequency
    var segments = 72;
    var angleStep = (Math.PI * 2) / segments;
    var maxBarLength = maxRadius * 0.48;

    for (var i = 0; i < segments; i++) {
      var angle = _circularRotation + i * angleStep;
      var bin = Math.floor((i / segments) * 64);
      var mag = (_freqData[bin] / 255);
      var barLen = mag * maxBarLength;

      var x1 = cx + Math.cos(angle) * baseRadius;
      var y1 = cy + Math.sin(angle) * baseRadius;
      var x2 = cx + Math.cos(angle) * (baseRadius + barLen);
      var y2 = cy + Math.sin(angle) * (baseRadius + barLen);

      var segGrad = _ctx.createLinearGradient(x1, y1, x2, y2);
      segGrad.addColorStop(0, hexToRgba(colors.secondary, 0.85));
      segGrad.addColorStop(1, hexToRgba(colors.primary, 0.95));

      _ctx.strokeStyle = segGrad;
      _ctx.lineWidth = Math.max(1.5, (Math.PI * 2 * baseRadius / segments) * 0.65);
      _ctx.lineCap = 'round';

      _ctx.beginPath();
      _ctx.moveTo(x1, y1);
      _ctx.lineTo(x2, y2);
      _ctx.stroke();

      // Outer ring particles detaching at peaks
      if (mag > 0.75 && Math.random() < 0.2) {
        _circularParticles.push({
          x: x2,
          y: y2,
          vx: Math.cos(angle) * (1.5 + Math.random() * 2),
          vy: Math.sin(angle) * (1.5 + Math.random() * 2),
          radius: 1.5 + Math.random() * 2,
          alpha: 1.0,
          color: (i % 2 === 0) ? colors.primary : colors.secondary
        });
      }
    }

    // 5. Update and render detached peak particles
    for (var p = _circularParticles.length - 1; p >= 0; p--) {
      var part = _circularParticles[p];
      part.x += part.vx;
      part.y += part.vy;
      part.alpha -= 0.025;

      if (part.alpha <= 0) {
        _circularParticles.splice(p, 1);
        continue;
      }

      _ctx.fillStyle = hexToRgba(part.color, part.alpha);
      _ctx.beginPath();
      _ctx.arc(part.x, part.y, part.radius, 0, Math.PI * 2);
      _ctx.fill();
    }
  }

  // ==========================================
  // Visualizer 3: Particle Visualizer ('particle')
  // ==========================================
  // Límite duro: evita que la lista crezca sin control y se vea "una fila
  // fila de partículas" cuando la velocidad subía demasiado.
  var MAX_PARTICLES = 260;

  function initParticleSystem() {
    _particleList = [];
    var totalParticles = 130;
    for (var i = 0; i < totalParticles; i++) {
      _particleList.push({
        x: Math.random() * _width,
        y: Math.random() * _height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        // Cada partícula tiene su propia caída: antes todas caían igual y
        // por eso se alineaban en filas.
        gravity: 0.004 + Math.random() * 0.010,
        baseRadius: 1.2 + Math.random() * 2.2,
        alpha: 0.22 + Math.random() * 0.45,
        colorIndex: i % 3
      });
    }
  }

  function renderParticle(colors) {
    if (_particleList.length === 0) {
      initParticleSystem();
    }

    var bass = getBassEnergy();
    var now = Date.now();
    var palette = [colors.primary, colors.secondary, colors.tertiary];

    var isPlaying = false;
    try {
      isPlaying = !!(Sonora.Player && typeof Sonora.Player.isPlaying === 'function' && Sonora.Player.isPlaying());
    } catch (e) { isPlaying = false; }

    // Estela suave SIN pintar un fondo oscuro. El canvas es transparente, así
    // que borrar con 'destination-out' deja sólo la estela de las partículas
    // (antes se rellenaba con un gris y se veía un recuadro apagado detrás).
    _ctx.save();
    _ctx.globalCompositeOperation = 'destination-out';
    _ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    _ctx.fillRect(0, 0, _width, _height);
    _ctx.restore();

    // Estallido desde el centro sólo en picos de graves reales y con pausa
    // mínima entre uno y otro, para que no se sature de partículas.
    if (isPlaying && bass > 0.62 && (now - _lastBeatTime > 480) && _particleList.length < MAX_PARTICLES) {
      _lastBeatTime = now;
      var spawnCount = 16;
      var cx = _width / 2;
      var cy = _height / 2;
      for (var b = 0; b < spawnCount; b++) {
        var burstAngle = Math.random() * Math.PI * 2;
        // Velocidad inicial mucho más lenta (antes 2 – 6.5 → se disparaban)
        var burstSpeed = 0.7 + Math.random() * 1.5;
        _particleList.push({
          x: cx + Math.cos(burstAngle) * 8,
          y: cy + Math.sin(burstAngle) * 8,
          vx: Math.cos(burstAngle) * burstSpeed,
          vy: Math.sin(burstAngle) * burstSpeed,
          gravity: 0.003 + Math.random() * 0.007,
          baseRadius: 1.8 + Math.random() * 2.2,
          alpha: 0.85,
          colorIndex: Math.floor(Math.random() * 3),
          ephemeral: true,
          life: 0.006 + Math.random() * 0.007
        });
      }
    }

    var connectionDistance = 60;
    var len = _particleList.length;
    // Antes 1.0 + bass * 1.6: a velocidad alta se veían "rayas" de partículas.
    var speedMultiplier = 1.0 + bass * 0.40;

    for (var i = len - 1; i >= 0; i--) {
      var p = _particleList[i];

      if (isPlaying) {
        p.vy += p.gravity;
        p.vy -= bass * 0.045;            // empuje suave, ya no saltan hacia arriba
        p.x += p.vx * speedMultiplier;
        p.y += p.vy * speedMultiplier;
        // Viscosidad: frena cualquier velocidad alta y evita el efecto "rayo".
        p.vx *= 0.994;
        p.vy *= 0.994;
      } else {
        // Al pausar no caen ni se disparan: se van frenando suavemente.
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.x += p.vx;
        p.y += p.vy;
      }

      if (p.ephemeral) {
        p.alpha -= p.life;
        if (p.alpha <= 0 || p.x < -30 || p.x > _width + 30 || p.y < -30 || p.y > _height + 30) {
          _particleList.splice(i, 1);
          continue;
        }
      } else {
        // Rebote en los bordes en lugar de "teletransporte" al lado opuesto
        // (el salto brusco generaba esas bandas ordenadas).
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
        if (p.x > _width) { p.x = _width; p.vx = -Math.abs(p.vx); }
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
        if (p.y > _height) { p.y = _height; p.vy = -Math.abs(p.vy); }
      }

      // Crece con los graves, pero con menos exageración
      var currentRadius = p.baseRadius * (1.0 + bass * 1.1);
      var pColor = palette[p.colorIndex];

      _ctx.fillStyle = hexToRgba(pColor, p.alpha);
      _ctx.beginPath();
      _ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
      _ctx.fill();

      // Constelación: sólo entre las partículas "base" (no las de estallido)
      // y saltando de 2 en 2 para no saturar la pantalla ni la CPU.
      if (p.ephemeral) continue;
      var checkLimit = Math.min(i + 14, len);
      for (var j = i + 1; j < checkLimit; j++) {
        var p2 = _particleList[j];
        if (!p2 || p2.ephemeral) continue;
        var dx = p.x - p2.x;
        var dy = p.y - p2.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < connectionDistance) {
          var lineAlpha = (1 - dist / connectionDistance) * 0.22 * (0.4 + bass * 0.5);
          _ctx.strokeStyle = hexToRgba(pColor, lineAlpha);
          _ctx.lineWidth = 0.7;
          _ctx.beginPath();
          _ctx.moveTo(p.x, p.y);
          _ctx.lineTo(p2.x, p2.y);
          _ctx.stroke();
        }
      }
    }
  }

  // ==========================================
  // Visualizer 4: 3D Bar Visualizer ('bar')
  // ==========================================
  function renderBar(colors) {
    var numBars = 32;
    var floorY = _height * 0.68;
    var maxBarHeight = floorY * 0.82;
    var barStep = _width / numBars;
    var barWidth = Math.max(3, barStep - 5);

    // 3D Perspective projection skew offsets
    var depthX = Math.max(3, Math.min(8, barWidth * 0.45));
    var depthY = -Math.max(4, Math.min(10, barWidth * 0.55));

    _ctx.clearRect(0, 0, _width, _height);

    for (var i = 0; i < numBars; i++) {
      var binIndex = Math.min(SPECTRUM_SIZE - 1, Math.floor(Math.pow(i / numBars, 1.2) * 75));
      var targetHeight = (_freqData[binIndex] / 255) * maxBarHeight;

      // Smooth interpolation
      _smoothedBar[i] += (targetHeight - _smoothedBar[i]) * 0.24;
      var barH = Math.max(3, _smoothedBar[i]);

      // Peak Hold indicators calculation
      if (barH >= _peakHoldBar[i]) {
        _peakHoldBar[i] = barH;
        _peakSpeedBar[i] = 0;
      } else {
        _peakSpeedBar[i] += 0.22;
        _peakHoldBar[i] = Math.max(0, _peakHoldBar[i] - _peakSpeedBar[i]);
      }

      var x = i * barStep + 2;
      var y = floorY - barH;

      // Color gradient across bars from left to right (theme colors)
      var ratio = i / numBars;
      var baseColor = (ratio < 0.5) ? colors.primary : colors.secondary;

      // 1. Subtle shadow beneath bar on floor plane
      _ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      _ctx.beginPath();
      _ctx.moveTo(x, floorY);
      _ctx.lineTo(x + depthX, floorY + depthY);
      _ctx.lineTo(x + barWidth + depthX, floorY + depthY);
      _ctx.lineTo(x + barWidth, floorY);
      _ctx.closePath();
      _ctx.fill();

      // 2. Reflection on floor plane (mirrored downward)
      var reflH = barH * 0.32;
      var reflGrad = _ctx.createLinearGradient(0, floorY, 0, floorY + reflH);
      reflGrad.addColorStop(0, hexToRgba(baseColor, 0.22));
      reflGrad.addColorStop(1, hexToRgba(baseColor, 0.0));

      _ctx.fillStyle = reflGrad;
      _ctx.fillRect(x, floorY, barWidth, reflH);

      // 3. Side face (Pseudo-3D shaded darker for depth)
      _ctx.fillStyle = hexToRgba(baseColor, 0.6);
      _ctx.beginPath();
      _ctx.moveTo(x + barWidth, y);
      _ctx.lineTo(x + barWidth + depthX, y + depthY);
      _ctx.lineTo(x + barWidth + depthX, floorY + depthY);
      _ctx.lineTo(x + barWidth, floorY);
      _ctx.closePath();
      _ctx.fill();

      // 4. Top face (Pseudo-3D highlighted lighter)
      _ctx.fillStyle = hexToRgba(baseColor, 0.98);
      _ctx.beginPath();
      _ctx.moveTo(x, y);
      _ctx.lineTo(x + depthX, y + depthY);
      _ctx.lineTo(x + barWidth + depthX, y + depthY);
      _ctx.lineTo(x + barWidth, y);
      _ctx.closePath();
      _ctx.fill();

      // 5. Front face with vertical gradient
      var frontGrad = _ctx.createLinearGradient(0, y, 0, floorY);
      frontGrad.addColorStop(0, colors.primary);
      frontGrad.addColorStop(1, colors.secondary);

      _ctx.fillStyle = frontGrad;
      _ctx.fillRect(x, y, barWidth, barH);

      // 6. Peak hold indicator cap
      var peakY = floorY - _peakHoldBar[i];
      if (peakY < y - 2) {
        _ctx.fillStyle = '#FFFFFF';
        _ctx.beginPath();
        _ctx.moveTo(x, peakY);
        _ctx.lineTo(x + depthX, peakY + depthY);
        _ctx.lineTo(x + barWidth + depthX, peakY + depthY);
        _ctx.lineTo(x + barWidth, peakY);
        _ctx.closePath();
        _ctx.fill();
      }
    }
  }

  /**
   * Main Render Loop (60fps requestAnimationFrame)
   */
  function renderLoop() {
    if (!_isRunning || !_ctx) return;

    try {
      updateFrequencyData();
      var colors = getColors();

      switch (_currentType) {
        case 'wave':
          renderWave(colors);
          break;
        case 'circular':
          renderCircular(colors);
          break;
        case 'particle':
          renderParticle(colors);
          break;
        case 'bar':
          renderBar(colors);
          break;
        case 'none':
        default:
          _ctx.clearRect(0, 0, _width, _height);
          break;
      }
    } catch (e) {
      console.warn('[Visualizer] Render error:', e);
    }

    if (_isRunning) {
      _rafId = requestAnimationFrame(renderLoop);
    }
  }

  /**
   * Visibility change handler (pauses RAF when tab is hidden to conserve battery)
   */
  function onVisibilityChange() {
    if (document.hidden) {
      if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
      }
    } else {
      if (_isRunning && !_rafId) {
        _rafId = requestAnimationFrame(renderLoop);
      }
    }
  }

  /**
   * Public Sonora.Visualizer Object
   */
  Sonora.Visualizer = {
    /**
     * Initialize visualizer with a canvas element
     * @param {HTMLCanvasElement} [canvasElement]
     */
    init: function (canvasElement) {
      try {
        var el = canvasElement || document.getElementById('visualizer-canvas');
        if (!el) {
          console.warn('[Visualizer] Canvas element not found');
          return;
        }

        _canvas = el;
        _ctx = _canvas.getContext('2d');

        this.resize();

        // Listen for element resize
        if (window.ResizeObserver) {
          if (_resizeObserver) {
            _resizeObserver.disconnect();
          }
          _resizeObserver = new ResizeObserver(function () {
            Sonora.Visualizer.resize();
          });
          _resizeObserver.observe(_canvas);
          if (_canvas.parentElement) {
            _resizeObserver.observe(_canvas.parentElement);
          }
        }

        // Add visibility listener
        document.removeEventListener('visibilitychange', onVisibilityChange);
        document.addEventListener('visibilitychange', onVisibilityChange);

        console.log('[Visualizer] Initialized successfully');
      } catch (err) {
        console.error('[Visualizer] Init error:', err);
      }
    },

    /**
     * Set visualization type: 'wave' | 'circular' | 'particle' | 'bar' | 'none'
     * @param {string} type
     */
    setType: function (type) {
      var validTypes = ['wave', 'circular', 'particle', 'bar', 'none'];
      if (validTypes.indexOf(type) !== -1) {
        _currentType = type;
        if (type === 'particle') {
          initParticleSystem();
        }
      }
    },

    /**
     * Get current visualization type
     */
    getType: function () {
      return _currentType;
    },

    /**
     * Start animation render loop
     */
    start: function () {
      if (!_canvas) {
        this.init();
      }
      if (!_isRunning) {
        _isRunning = true;
        if (!_rafId) {
          _rafId = requestAnimationFrame(renderLoop);
        }
      }
    },

    /**
     * Stop animation render loop
     */
    stop: function () {
      _isRunning = false;
      if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
      }
      if (_ctx) {
        _ctx.clearRect(0, 0, _width, _height);
      }
    },

    /**
     * Handle canvas resize with High-DPI scaling
     */
    resize: function () {
      if (!_canvas || !_ctx) return;

      try {
        var rect = _canvas.getBoundingClientRect();
        var clientW = rect.width || _canvas.clientWidth || 300;
        var clientH = rect.height || _canvas.clientHeight || 200;

        _width = Math.floor(clientW);
        _height = Math.floor(clientH);

        // Cap DPR at 2 for smooth mobile performance
        _dpr = Math.min(window.devicePixelRatio || 1, 2);

        _canvas.width = Math.floor(_width * _dpr);
        _canvas.height = Math.floor(_height * _dpr);

        _ctx.setTransform(1, 0, 0, 1, 0, 0);
        _ctx.scale(_dpr, _dpr);

        if (_currentType === 'particle') {
          initParticleSystem();
        }
      } catch (err) {
        console.error('[Visualizer] Resize error:', err);
      }
    },

    /**
     * Set explicit color palette
     * @param {Array<string>} colors Array of hex/rgb color strings
     */
    setColorScheme: function (colors) {
      if (Array.isArray(colors) && colors.length > 0) {
        _customColorScheme = colors.slice();
      } else {
        _customColorScheme = null;
      }
    },

    /**
     * Full cleanup of all resources, listeners, and timers
     */
    destroy: function () {
      this.stop();

      if (_resizeObserver) {
        _resizeObserver.disconnect();
        _resizeObserver = null;
      }

      document.removeEventListener('visibilitychange', onVisibilityChange);

      _canvas = null;
      _ctx = null;
      _particleList = [];
      _circularParticles = [];
      _customColorScheme = null;

      console.log('[Visualizer] Destroyed and cleaned up');
    }
  };
})();
