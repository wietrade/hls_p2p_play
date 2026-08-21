/*!
 * p2p-media-loader 4.0.0 自定义分片持久缓存（IndexedDB）
 *
 * 参考官方示例：
 *   packages/p2p-media-loader-demo/src/custom-segment-storage-example/
 *     indexed-db-storage.ts / indexed-db-wrapper.ts
 *
 * 用法（play.html coreCfg 已接入，也可在任意页面复用）：
 *   customSegmentStorageFactory: () => new P2PML.IndexedDbStorage({ limitMiB: 1024 })
 *
 * 特性：
 *  - 分片数据 + 元信息持久化到 IndexedDB：页面刷新 / 换源后仍可命中，点播场景大幅提升缓存命中率
 *  - 容量上限逐出：超过 limitMiB 后按 startTime 最老优先删除（直播/长会话内存与磁盘有界）
 *  - IndexedDB 不可用（隐私模式 / 老浏览器）时自动退化为内存 Map，功能不中断
 *  - 存储异常内部吞掉并降级，绝不打断播放（core 对 storeSegment 是 fire-and-forget 调用）
 */
(function (global) {
  "use strict";

  var BYTES_PER_MiB = 1048576;
  var INFO_STORE = "segmentInfo";
  var DATA_STORE = "segmentData";
  var DB_VERSION = 1;

  function storageId(streamSwarmId, segmentId) {
    return streamSwarmId + "|" + segmentId;
  }

  /* ---- IndexedDB 薄封装（Promise 化）---- */
  function IndexedDbWrapper(dbName) {
    this.dbName = dbName;
    this.db = null;
  }
  IndexedDbWrapper.prototype.open = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(self.dbName, DB_VERSION);
      req.onerror = function () {
        reject(new Error("Failed to open database: " + self.dbName));
      };
      req.onsuccess = function () {
        self.db = req.result;
        resolve();
      };
      req.onupgradeneeded = function (e) {
        self.db = e.target.result;
        [DATA_STORE, INFO_STORE].forEach(function (name) {
          if (!self.db.objectStoreNames.contains(name)) {
            self.db.createObjectStore(name, { keyPath: "storageId" });
          }
        });
      };
    });
  };
  IndexedDbWrapper.prototype.tx = function (storeName, mode, op) {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (!self.db) return reject(new Error("Database not initialized"));
      var transaction = self.db.transaction(storeName, mode);
      var store = transaction.objectStore(storeName);
      var request;
      try {
        request = op(store);
      } catch (e) {
        return reject(e);
      }
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("IndexedDB operation failed"));
      };
    });
  };
  IndexedDbWrapper.prototype.getAll = function (storeName) {
    return this.tx(storeName, "readonly", function (store) {
      return store.getAll();
    });
  };
  IndexedDbWrapper.prototype.put = function (storeName, item) {
    return this.tx(storeName, "readwrite", function (store) {
      return store.put(item);
    });
  };
  IndexedDbWrapper.prototype.get = function (storeName, key) {
    return this.tx(storeName, "readonly", function (store) {
      return store.get(key);
    });
  };
  IndexedDbWrapper.prototype["delete"] = function (storeName, key) {
    return this.tx(storeName, "readwrite", function (store) {
      return store["delete"](key);
    });
  };
  IndexedDbWrapper.prototype.close = function () {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  };

  /* ---- SegmentStorage 实现（实现 p2p-media-loader 4.0.0 接口）---- */
  function IndexedDbStorage(opts) {
    opts = opts || {};
    this.dbName = opts.dbName || "p2p-media-loader-play";
    this.limitMiB = opts.limitMiB > 0 ? opts.limitMiB : 1024;
    this.db = new IndexedDbWrapper(this.dbName);
    this.cache = new Map(); // storageId -> infoItem（同步判定 hasSegment / 枚举）
    this.memData = new Map(); // storageId -> ArrayBuffer（IndexedDB 不可用时的降级）
    this.persist = false; // initialize 后确定
    this.currentMemoryStorageSize = 0; // 单位 MiB
    this.storageConfig = null;
    this.mainStreamConfig = null;
    this.secondaryStreamConfig = null;
    this.currentPlayback = null;
    this.lastRequestedSegment = null;
    this.segmentChangeCallback = null;
  }

  IndexedDbStorage.prototype.log = function (msg) {
    try {
      console.log("[p2p-indexeddb] " + msg);
    } catch (e) {}
  };

  IndexedDbStorage.prototype.onPlaybackUpdated = function (position, rate) {
    this.currentPlayback = { position: position, rate: rate };
  };

  IndexedDbStorage.prototype.onSegmentRequested = function (
    swarmId,
    streamSwarmId,
    segmentId,
    startTime,
    endTime,
    streamType,
    isLiveStream
  ) {
    this.lastRequestedSegment = {
      swarmId: swarmId,
      streamSwarmId: streamSwarmId,
      segmentId: segmentId,
      startTime: startTime,
      endTime: endTime,
      streamType: streamType,
      isLiveStream: isLiveStream,
    };
  };

  IndexedDbStorage.prototype.initialize = async function (
    coreConfig,
    mainStreamConfig,
    secondaryStreamConfig
  ) {
    this.storageConfig = coreConfig || null;
    this.mainStreamConfig = mainStreamConfig || null;
    this.secondaryStreamConfig = secondaryStreamConfig || null;
    // 容量上限优先取 core 配置（segmentMemoryStorageLimit），其次构造参数
    if (coreConfig && coreConfig.segmentMemoryStorageLimit) {
      this.limitMiB = coreConfig.segmentMemoryStorageLimit;
    }
    if (typeof indexedDB === "undefined" || !indexedDB.open) {
      this.persist = false;
      this.log("IndexedDB 不可用，退化为内存缓存");
      return;
    }
    try {
      await this.db.open();
      this.persist = true;
      await this._loadCacheMap();
    } catch (error) {
      this.persist = false;
      this.log(
        "初始化 IndexedDB 失败，退化为内存缓存: " + (error && error.message)
      );
      try {
        this.db.close();
      } catch (e) {}
    }
  };

  IndexedDbStorage.prototype.storeSegment = async function (
    _swarmId,
    streamSwarmId,
    segmentId,
    data,
    startTime,
    endTime,
    streamType,
    _isLiveStream
  ) {
    var sid = storageId(streamSwarmId, segmentId);
    var infoItem = {
      storageId: sid,
      dataLength: data.byteLength,
      streamSwarmId: streamSwarmId,
      segmentId: segmentId,
      streamType: streamType,
      startTime: startTime,
      endTime: endTime,
      swarmId: _swarmId,
    };
    try {
      if (this.persist) {
        await Promise.all([
          this.db.put(DATA_STORE, { storageId: sid, data: data }),
          this.db.put(INFO_STORE, infoItem),
        ]);
      } else {
        this.memData.set(sid, data);
      }
      if (!this.cache.has(sid)) {
        this.currentMemoryStorageSize += data.byteLength / BYTES_PER_MiB;
      }
      this.cache.set(sid, infoItem);
      await this._evictIfOverLimit();
    } catch (error) {
      // 存储失败不影响播放：该分片降级为内存记录
      this.log(
        "store segment " + segmentId + " 失败（降级内存）: " + (error && error.message)
      );
      this.memData.set(sid, data);
      if (!this.cache.has(sid)) {
        this.currentMemoryStorageSize += data.byteLength / BYTES_PER_MiB;
      }
      this.cache.set(sid, infoItem);
    }
    if (this.segmentChangeCallback) {
      try {
        this.segmentChangeCallback(streamSwarmId);
      } catch (e) {}
    }
  };

  IndexedDbStorage.prototype.getSegmentData = async function (
    _swarmId,
    streamSwarmId,
    segmentId
  ) {
    var sid = storageId(streamSwarmId, segmentId);
    try {
      if (this.persist) {
        var result = await this.db.get(DATA_STORE, sid);
        return result ? result.data : undefined;
      }
      return this.memData.get(sid);
    } catch (error) {
      this.log("get segment data " + sid + " 失败: " + (error && error.message));
      return undefined;
    }
  };

  IndexedDbStorage.prototype.getUsage = function () {
    return {
      totalCapacity: this.limitMiB,
      usedCapacity: this.currentMemoryStorageSize,
    };
  };

  IndexedDbStorage.prototype.hasSegment = function (
    _swarmId,
    streamSwarmId,
    segmentId
  ) {
    return this.cache.has(storageId(streamSwarmId, segmentId));
  };

  IndexedDbStorage.prototype.getStoredSegmentIds = function (
    _swarmId,
    streamSwarmId
  ) {
    var ids = [];
    this.cache.forEach(function (item) {
      if (item.streamSwarmId === streamSwarmId) ids.push(item.segmentId);
    });
    return ids;
  };

  IndexedDbStorage.prototype.destroy = function () {
    try {
      this.db.close();
    } catch (e) {}
    this.cache.clear();
    this.memData.clear();
  };

  IndexedDbStorage.prototype.setSegmentChangeCallback = function (callback) {
    this.segmentChangeCallback = callback;
  };

  // 启动时把元信息载入内存 Map（hasSegment/枚举用），数据仍在 IndexedDB 里按需读取
  IndexedDbStorage.prototype._loadCacheMap = async function () {
    var result = await this.db.getAll(INFO_STORE);
    var self = this;
    result.forEach(function (item) {
      var sid = storageId(item.streamSwarmId, item.segmentId);
      self.cache.set(sid, item);
      self.currentMemoryStorageSize += item.dataLength / BYTES_PER_MiB;
    });
    this.log(
      "启动加载缓存 " + result.length + " 条分片记录 (" + this.currentMemoryStorageSize.toFixed(1) + " MiB)"
    );
    await this._evictIfOverLimit();
  };

  // 容量逐出：按 startTime 最老优先删除，直到低于 limitMiB（与官方 MemoryCache 的"老分片优先"一致）
  IndexedDbStorage.prototype._evictIfOverLimit = async function () {
    if (this.currentMemoryStorageSize <= this.limitMiB) return;
    var items = Array.from(this.cache.values()).sort(function (a, b) {
      return a.startTime - b.startTime;
    });
    for (var i = 0; i < items.length; i++) {
      if (this.currentMemoryStorageSize <= this.limitMiB) break;
      var item = items[i];
      var sid = storageId(item.streamSwarmId, item.segmentId);
      this.cache.delete(sid);
      this.memData.delete(sid);
      this.currentMemoryStorageSize -= item.dataLength / BYTES_PER_MiB;
      if (this.persist) {
        try {
          await this.db["delete"](DATA_STORE, sid);
        } catch (e) {}
        try {
          await this.db["delete"](INFO_STORE, sid);
        } catch (e) {}
      }
      this.log("逐出 segment " + item.segmentId + " from " + item.streamSwarmId);
    }
  };

  global.P2PML = global.P2PML || {};
  global.P2PML.IndexedDbStorage = IndexedDbStorage;
  global.P2PML.createIndexedDbStorage = function (opts) {
    return new IndexedDbStorage(opts);
  };
})(typeof window !== "undefined" ? window : globalThis);
