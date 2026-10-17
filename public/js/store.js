/**
 * Sonora Music — Global State Store
 * Lightweight reactive state management with pub/sub
 */
(function () {
  'use strict';

  const Sonora = window.Sonora = window.Sonora || {};

  const _state = {};
  const _subscribers = {};   // key -> Set of callbacks
  const _eventListeners = {}; // event -> Set of callbacks

  Sonora.Store = {
    /**
     * Get a state value by key
     */
    get(key) {
      return _state[key];
    },

    /**
     * Set a state value and notify subscribers
     */
    set(key, value) {
      const old = _state[key];
      _state[key] = value;
      if (_subscribers[key]) {
        _subscribers[key].forEach(function (cb) {
          try { cb(value, old, key); } catch (e) { console.error('[Store] Subscriber error:', e); }
        });
      }
    },

    /**
     * Subscribe to state changes on a specific key.
     * Returns an unsubscribe function.
     */
    subscribe(key, callback) {
      if (!_subscribers[key]) _subscribers[key] = new Set();
      _subscribers[key].add(callback);
      return function () { _subscribers[key] && _subscribers[key].delete(callback); };
    },

    /**
     * Emit a named event with optional data
     */
    emit(event, data) {
      if (_eventListeners[event]) {
        _eventListeners[event].forEach(function (cb) {
          try { cb(data); } catch (e) { console.error('[Store] Event listener error:', e); }
        });
      }
    },

    /**
     * Listen to a named event.
     * Returns an unsubscribe function.
     */
    on(event, callback) {
      if (!_eventListeners[event]) _eventListeners[event] = new Set();
      _eventListeners[event].add(callback);
      return function () { _eventListeners[event] && _eventListeners[event].delete(callback); };
    },

    /**
     * Remove a specific event listener
     */
    off(event, callback) {
      if (_eventListeners[event]) {
        _eventListeners[event].delete(callback);
      }
    },

    /**
     * Get entire state snapshot (read-only copy)
     */
    getState() {
      return Object.assign({}, _state);
    },

    /**
     * Batch update multiple keys, notifying once per key
     */
    batch(updates) {
      Object.keys(updates).forEach(function (key) {
        Sonora.Store.set(key, updates[key]);
      });
    },

    /**
     * Initialize default state values
     */
    init() {
      Sonora.Store.batch({
        currentTrack: null,
        queue: [],
        queueIndex: -1,
        isPlaying: false,
        volume: 0.8,
        shuffle: false,
        repeatMode: 'off', // 'off' | 'all' | 'one'
        progress: { current: 0, duration: 0, percent: 0 },
        theme: 'coral',
        darkMode: 'dark',
        fontSize: 'medium',
        serverMode: 'off', // 'local' | 'render' | 'off'
        serverLocalUrl: 'http://192.168.1.132:3000',
        serverRenderUrl: 'https://sonora-app-v4.onrender.com',
        language: 'es',
        customBg: null,
        currentPage: 'home',
        isLoading: false,
        miniPlayerVisible: false,
        fullPlayerVisible: false,
        crossfade: 0,
        playbackSpeed: 1.0,
        sleepTimer: null
      });
      console.log('[Store] Initialized');
    }
  };
})();
