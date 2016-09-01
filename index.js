const debug = require('debug')('redis-cache-plugin');
const service = require('./lib/service');

function init() {

}

function middleware(app, plugin, generalConfig) {
    debug('Loading redis-cache-plugin');
    app.use(service(plugin).middleware);
}


module.exports = {
    middleware,
    init,
};
