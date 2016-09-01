const debug = require('debug')('redis-cache-plugin');
const bluebird = require('bluebird');
const redis = require('redis');
bluebird.promisifyAll(redis.RedisClient.prototype);
const etag = require('etag');

module.exports = function init(plugin) {
    const redisClient = redis.createClient({
        host: plugin.config.redis.host,
        port: plugin.config.redis.port,
    });

    function setHeaders(ctx, headers) {
        if (headers) {
            const keys = Object.keys(headers);
            for (let i = 0, length = keys.length; i < length; i++) {
                ctx.set(keys[i], headers[keys[i]]);
            }
        }
    }

    function getDiffHeaders(oldHeaders, newHeaders) {
        const oldKeys = Object.keys(oldHeaders);
        const newKeys = Object.keys(newHeaders);
        const headers = {};
        for (let i = 0, length = newKeys.length; i < length; i++) {
            if (oldKeys.indexOf(newKeys[i]) !== -1) {
                headers[newKeys[i]] = newKeys[newKeys[i]];
            }
        }
        return headers;
    }

    async function middleware(ctx, next) {
        let data = await redisClient.getAsync(ctx.request.url);
        if (data) {
            data = JSON.parse(data);
            debug('Request cached');
            const etagValue = etag(JSON.stringify(data.body));
            ctx.set('ETag', etagValue);
            setHeaders(ctx, data.headers);
            if (ctx.headers && ctx.headers['if-none-match'] === etagValue) {
                ctx.res.statusCode = 304;
                return;
            }
            ctx.body = data.body;
            return;
        }
        const headers = Object.assign({}, ctx.request.headers);
        await next();
        if (ctx.res.statusCode === 200 && ctx.request.method === 'GET'
            && ctx.state.redirect && ctx.state.redirect.endpoint && !ctx.state.redirect.endpoint.authenticated
            && !ctx.state.redirect.endpoint.binary) {
            debug('Caching request ', ctx.request.url);
            redisClient.setex(ctx.request.url, plugin.config.timeCache || 10, JSON.stringify({
                body: ctx.body,
                headers: getDiffHeaders(headers, ctx.headers),
            }));
        }
    }

    return {
        middleware,
    };

};
