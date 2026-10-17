/**
 * Sonora Music — SPA Router
 * Hash-based client-side routing
 */
(function () {
  'use strict';

  var Sonora = window.Sonora = window.Sonora || {};

  var _routes = {};
  var _currentPath = '';
  var _params = {};
  var _beforeHooks = [];

  function parsePath(hash) {
    var h = (hash || window.location.hash).replace(/^#\/?/, '/');
    if (h === '' || h === '/') h = '/';
    return h;
  }

  function matchRoute(path) {
    // Exact match first
    if (_routes[path]) return { handler: _routes[path], params: {} };

    // Param matching (e.g., /playlist/:id)
    var keys = Object.keys(_routes);
    for (var i = 0; i < keys.length; i++) {
      var pattern = keys[i];
      if (pattern.indexOf(':') === -1) continue;
      var patternParts = pattern.split('/');
      var pathParts = path.split('/');
      if (patternParts.length !== pathParts.length) continue;

      var params = {};
      var matched = true;
      for (var j = 0; j < patternParts.length; j++) {
        if (patternParts[j].charAt(0) === ':') {
          params[patternParts[j].substring(1)] = decodeURIComponent(pathParts[j]);
        } else if (patternParts[j] !== pathParts[j]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: _routes[pattern], params: params };
    }
    return null;
  }

  function handleRoute() {
    var path = parsePath();
    if (path === _currentPath) return;

    var match = matchRoute(path);
    if (!match) {
      // Fallback to home
      match = matchRoute('/');
      path = '/';
    }

    // Run before hooks
    for (var i = 0; i < _beforeHooks.length; i++) {
      try {
        if (_beforeHooks[i](_currentPath, path) === false) return;
      } catch (e) { console.error('[Router] Before hook error:', e); }
    }

    _currentPath = path;
    _params = match ? match.params : {};

    if (match && match.handler) {
      try {
        match.handler(_params);
      } catch (e) {
        console.error('[Router] Route handler error:', e);
      }
    }
  }

  Sonora.Router = {
    /**
     * Register a route handler
     */
    on: function (path, handler) {
      _routes[path] = handler;
      return this;
    },

    /**
     * Navigate to a path
     */
    navigate: function (path) {
      window.location.hash = '#' + path;
    },

    /**
     * Get a route parameter by name
     */
    getParam: function (name) {
      return _params[name] || null;
    },

    /**
     * Get all current params
     */
    getParams: function () {
      return Object.assign({}, _params);
    },

    /**
     * Get current path
     */
    getCurrentPath: function () {
      return _currentPath;
    },

    /**
     * Add a before-navigation hook
     * Return false from hook to cancel navigation
     */
    before: function (hook) {
      _beforeHooks.push(hook);
    },

    /**
     * Replace current route without adding to history
     */
    replace: function (path) {
      window.location.replace('#' + path);
    },

    /**
     * Go back
     */
    back: function () {
      window.history.back();
    },

    /**
     * Start the router - listen for hash changes
     */
    start: function () {
      window.addEventListener('hashchange', handleRoute);
      // Handle initial route
      if (!window.location.hash || window.location.hash === '#') {
        window.location.hash = '#/';
      } else {
        handleRoute();
      }
    },

    /**
     * Force re-evaluate current route
     */
    refresh: function () {
      _currentPath = ''; // reset so it re-runs
      handleRoute();
    },

    /**
     * Stop listening
     */
    stop: function () {
      window.removeEventListener('hashchange', handleRoute);
    }
  };
})();
