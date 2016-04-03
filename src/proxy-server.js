// External deps use normal require
var http = require('http');
var httpProxy = require('http-proxy');
var EventEmitter = require('events');

// Internal deps use ES6 module syntax
import {Upstream} from './upstream';
import {Route} from './route';
import {routeUpstream} from './plugins/route-upstream';
import {router} from './plugins/router';

// Private stuff
const _proxy = Symbol('proxy');
const _upstreams = Symbol('upstreams');
const _routes = Symbol('routes');
const _server = Symbol('server');

export class ProxyServer extends EventEmitter {
	constructor (opts = {}, onListen) {
		super();

		// Save the host and port the server was opened on
		this.hostname = opts.hostname || null;
		this.port = opts.port || null;

		// Create http server
		this[_server] = http.createServer((req, res) => {
			this.emit('request', req, res);
		});
		this[_server].on('error', (err) => {
			this.emit('error', err);
		});

		// Create the proxy server
		this[_proxy] = httpProxy.createProxyServer({
			changeOrigin: typeof opts.changeOrigin === 'undefined' ? true : opts.changeOrigin,
			xfwd: typeof opts.xfwd === 'undefined' ? true : opts.xfwd,
			headers: opts.headers
		});
		this[_proxy].on('error', (err) => {
			this.emit('error', err);
		});
		this[_proxy].on('proxyReq', (proxyReq, req, res, options) => {
			this.emit('proxyReq', proxyReq, req, res, options);
		});
		this[_proxy].on('proxyRes', (proxyRes, req, res) => {
			this.emit('proxyRes', proxyRes, req, res);
		});

		// Setup plugins
		this.initPlugin(routeUpstream, opts);
		opts.plugins && this.initPlugin(opts.plugins, opts);
		this.initPlugin(router, opts);

		// Register upstreams
		this[_upstreams] = {};
		opts.upstreams && this.registerUpstream(opts.upstreams);

		// Register the routes from the config
		this[_routes] = [];
		opts.routes && this.registerRoute(opts.routes);

		// If onListen then start listening
		if (typeof onListen === 'function') {
			this.listen(onListen);
		}
	}

	/**
	 * Start listening on a port and hostname
	 *
	 */
	listen (port, hostname, done = function () {}) {
		if (typeof port === 'function') {
			done = port;
			port = this.port;
			hostname = this.hostname;
		} else if (typeof hostname === 'function') {
			done = hostname;
			hostname = this.hostname;
		}

		this[_server].listen(port, hostname, (err) => {
			this.hostname = hostname;
			this.port = this[_server].address().port;
			done(err);
		});
	}

	/**
	 * Initalize plugins
	 *
	 */
	initPlugin (plugin, opts) {
		// Init multiple if an array
		if (Array.isArray(plugin)) {
			return plugin.forEach((p) => {
				this.initPlugin(p, opts);
			});
		}
		plugin(this, opts);
	}

	/**
	 * Registers the upstream servers
	 *
	 */
	registerUpstream (name, upstream) {
		if (typeof name === 'object') {
			return Object.keys(name).map((k) => {
				this.registerUpstream(k, name[k]);
			});
		}

		// Require name and upstream to add
		if (!name) {
			throw new TypeError('upstream name cannot be undefined');
		}
		if (!upstream) {
			throw new TypeError('upstream cannot be undefined');
		}

		upstream.proxy = this[_proxy];
		this[_upstreams][name] = new Upstream(name, upstream);

		return this[_upstreams][name];
	}

	/**
	 * Get an upstream that has been registered with a given name
	 *
	 */
	getUpstream (name) {
		return this[_upstreams][name];
	}

	/**
	 * Registers the known routes with the router
	 *
	 */
	registerRoute (r) {
		// Register multiple as an array
		if (Array.isArray(r)) {
			return r.map(this.registerRoute.bind(this));
		}

		// Create route object
		var route = new Route(r);
		this[_routes].push(route);

		// Plugin hook
		this.emit('registerRoute', route);

		return route;
	}

	/**
	 * Close the server
	 *
	 */
	close (done = function () {}) {
		this[_server].close(() => {
			this.proxy.close(() => {
				done();
			});
		});
	}
}
