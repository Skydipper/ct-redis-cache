const debug = require('debug')('redis-cache-plugin');
const bluebird = require('bluebird');
const redis = require('redis');
bluebird.promisifyAll(redis.RedisClient.prototype);
const etag = require('etag');

function getUser(ctx) {
    return ctx.req.user || ctx.state.user;
}

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

    async function checkFlushCache(ctx, next) {
        await next();
        if (ctx.response.header['cache-control'] === 'flush') {
            await redisClient.flushdb();
            delete ctx.response.header['cache-control'];
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
        if (ctx.path === '/cache/flush') {
            if (!getUser(ctx)) {
                ctx.throw(403, 'Not authorized');
                return;
            }
            await redisClient.flushdb();
            ctx.body = '';
            return;
        }
        if (ctx.request.method !== 'GET' || ctx.headers['cache-control'] === 'no-cache') {
            await next();
            return;
        }
        let data = await redisClient.getAsync(`${ctx.request.url}-data`);
        if (data) {
            let headers = await redisClient.getAsync(`${ctx.request.url}-headers`);
            if (headers) {
                headers = JSON.parse(headers);
            }
            try {
                debug('data obtained', data);
                data = JSON.parse(data);
                debug('Request cached');
                const etagValue = etag(JSON.stringify(data));
                ctx.etag = etagValue;
                setHeaders(ctx, headers);
                if (ctx.headers && ctx.headers['if-none-match'] === etagValue) {
                    ctx.res.statusCode = 304;
                    return;
                }
                ctx.body = data;

                ctx.state.isCached = true;
            } catch (e) {
                debug(e);
            }
            return;
        }
        const headers = Object.assign({}, ctx.request.headers);
        await next();
        if (ctx.res.statusCode === 200 && ctx.request.method === 'GET' &&
            ctx.state.redirect && ctx.state.redirect.endpoint && !ctx.state.redirect.endpoint.authenticated) {
            if (ctx.body.on) {
                ctx.body.on('data', (chunk) => {
                    redisClient.append(`${ctx.request.url}-data`, chunk);
                });

                ctx.body.on('end', () => {
                    if (ctx.res.statusCode >= 200 && ctx.res.statusCode < 300) {
                        debug('Saving headers');
                        redisClient.setex(`${ctx.request.url}-headers`, plugin.config.timeCache || 10, JSON.stringify(getDiffHeaders(headers, ctx.headers)));
                    } else {
                        debug('Removing key by error');
                        redisClient.del(`${ctx.request.url}-data`);
                    }
                });

            } else {
                redisClient.setex(`${ctx.request.url}-data`, plugin.config.timeCache || 10, JSON.stringify(ctx.body));
                redisClient.setex(`${ctx.request.url}-headers`, plugin.config.timeCache || 10, JSON.stringify(getDiffHeaders(headers, ctx.headers)));
            }

        }

    }

    return {
        middleware,
        checkFlushCache,
    };

};
