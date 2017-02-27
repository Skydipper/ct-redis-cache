const debug = require('debug')('redis-cache-plugin');
const service = require('./lib/service');

function init() {

}

function middleware(app, plugin, generalConfig) {
    debug('Loading redis-cache-plugin');
    const instance = service(plugin);
    app.use(instance.middleware);
    app.use(instance.checkFlushCache);
}


module.exports = {
    middleware,
    init,
};
