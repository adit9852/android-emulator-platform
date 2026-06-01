const redis = require('redis');
const logger = require('./logger');

let redisClient = null;

/**
 * Initialize Redis connection
 */
async function initializeRedis() {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Redis reconnection failed after 10 attempts');
            return new Error('Redis reconnection limit exceeded');
          }
          return retries * 100; // Exponential backoff
        }
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis reconnecting...');
    });

    await redisClient.connect();
    
    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    throw error;
  }
}

/**
 * Get Redis client instance
 */
function getRedisClient() {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initializeRedis() first.');
  }
  return redisClient;
}

/**
 * Set a key-value pair with optional expiration
 */
async function set(key, value, expirationSeconds = null) {
  try {
    const client = getRedisClient();
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    
    if (expirationSeconds) {
      await client.setEx(key, expirationSeconds, stringValue);
    } else {
      await client.set(key, stringValue);
    }
    
    return true;
  } catch (error) {
    logger.error(`Redis SET error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Get a value by key
 */
async function get(key) {
  try {
    const client = getRedisClient();
    const value = await client.get(key);
    
    if (!value) return null;
    
    // Try to parse as JSON, return as string if it fails
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    logger.error(`Redis GET error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Delete a key
 */
async function del(key) {
  try {
    const client = getRedisClient();
    await client.del(key);
    return true;
  } catch (error) {
    logger.error(`Redis DEL error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Check if a key exists
 */
async function exists(key) {
  try {
    const client = getRedisClient();
    const result = await client.exists(key);
    return result === 1;
  } catch (error) {
    logger.error(`Redis EXISTS error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Set expiration on a key
 */
async function expire(key, seconds) {
  try {
    const client = getRedisClient();
    await client.expire(key, seconds);
    return true;
  } catch (error) {
    logger.error(`Redis EXPIRE error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Get all keys matching a pattern
 */
async function keys(pattern) {
  try {
    const client = getRedisClient();
    return await client.keys(pattern);
  } catch (error) {
    logger.error(`Redis KEYS error for pattern ${pattern}:`, error);
    throw error;
  }
}

/**
 * Increment a counter
 */
async function incr(key) {
  try {
    const client = getRedisClient();
    return await client.incr(key);
  } catch (error) {
    logger.error(`Redis INCR error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Decrement a counter
 */
async function decr(key) {
  try {
    const client = getRedisClient();
    return await client.decr(key);
  } catch (error) {
    logger.error(`Redis DECR error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Add to a set
 */
async function sadd(key, ...members) {
  try {
    const client = getRedisClient();
    return await client.sAdd(key, members);
  } catch (error) {
    logger.error(`Redis SADD error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Remove from a set
 */
async function srem(key, ...members) {
  try {
    const client = getRedisClient();
    return await client.sRem(key, members);
  } catch (error) {
    logger.error(`Redis SREM error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Get all members of a set
 */
async function smembers(key) {
  try {
    const client = getRedisClient();
    return await client.sMembers(key);
  } catch (error) {
    logger.error(`Redis SMEMBERS error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Check if member exists in set
 */
async function sismember(key, member) {
  try {
    const client = getRedisClient();
    const result = await client.sIsMember(key, member);
    return result === 1;
  } catch (error) {
    logger.error(`Redis SISMEMBER error for key ${key}:`, error);
    throw error;
  }
}

/**
 * Flush all data (use with caution!)
 */
async function flushAll() {
  try {
    const client = getRedisClient();
    await client.flushAll();
    logger.warn('Redis: All data flushed');
    return true;
  } catch (error) {
    logger.error('Redis FLUSHALL error:', error);
    throw error;
  }
}

/**
 * Close Redis connection
 */
async function closeRedis() {
  try {
    if (redisClient) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }
  } catch (error) {
    logger.error('Error closing Redis connection:', error);
  }
}

module.exports = {
  initializeRedis,
  getRedisClient,
  set,
  get,
  del,
  exists,
  expire,
  keys,
  incr,
  decr,
  sadd,
  srem,
  smembers,
  sismember,
  flushAll,
  closeRedis
};
