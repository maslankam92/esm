import { extname as _extname, dirname, join } from "path"

import Entry from "../entry.js"
import Module from "module"
import Parser from "../parser.js"
import PkgInfo from "../pkg-info.js"
import Runtime from "../runtime.js"
import Wrapper from "../wrapper.js"

import attempt from "../util/attempt.js"
import binding from "../binding/fs.js"
import compiler from "../caching-compiler.js"
import encodeIdent from "../util/encode-ident.js"
import extname from "../util/extname.js"
import fs from "fs"
import getCacheFileName from "../util/get-cache-file-name.js"
import getCacheStateHash from "../util/get-cache-state-hash.js"
import gunzip from "../fs/gunzip.js"
import isObject from "../util/is-object.js"
import keys from "../util/keys.js"
import maskStackTrace from "../error/mask-stack-trace.js"
import mtime from "../fs/mtime.js"
import readFile from "../fs/read-file.js"
import { satisfies } from "semver"
import setSourceType from "../util/set-source-type.js"

let allowTopLevelAwait = isObject(process.mainModule) &&
  satisfies(process.version, ">=7.6.0")

const passthruMap = new Map

function managerWrapper(manager, func, args) {
  const filePath = args[1]
  const pkgInfo = PkgInfo.get(dirname(filePath))
  const wrapped = pkgInfo === null ? null : Wrapper.find(exts, ".js", pkgInfo.range)

  return wrapped === null
    ? func.apply(this, args)
    : wrapped.call(this, manager, func, pkgInfo, args)
}

function methodWrapper(manager, func, pkgInfo, args) {
  /* eslint consistent-return: off */
  const mod = args[0]
  const filePath = args[1]
  const pkgOptions = pkgInfo.options
  const cachePath = pkgInfo.cachePath

  if (cachePath === null) {
    return func.apply(this, args)
  }

  const ext = extname(filePath)
  let hint = "script"
  let type = "script"

  if (pkgOptions.esm === "js") {
    type = "unambiguous"
  }

  if (ext === ".mjs" || ext === ".mjs.gz") {
    hint = "module"
    if (type === "script") {
      type = "module"
    }
  }

  if (pkgOptions.esm === "mjs" && type !== "module") {
    return func.apply(this, args)
  }

  const cache = pkgInfo.cache
  const cacheKey = mtime(filePath)
  const cacheFileName = getCacheFileName(filePath, cacheKey, pkgInfo)

  const stateHash = getCacheStateHash(cacheFileName)
  const runtimeAlias = encodeIdent("_" + stateHash.slice(0, 3))

  let cacheCode
  let sourceCode
  let cacheValue = cache[cacheFileName]

  if (cacheValue === true) {
    cacheCode = readCode(join(cachePath, cacheFileName), pkgOptions)
  } else {
    sourceCode = readCode(filePath, pkgOptions)
  }

  if (! isObject(cacheValue)) {
    if (cacheValue === true) {
      if (type === "unambiguous") {
        type = Parser.hasPragma(cacheCode, "use script") ? "script" : "module"
      }

      cacheValue = { code: cacheCode, type }
      cache[cacheFileName] = cacheValue
    } else {
      const compilerOptions = {
        cacheFileName,
        cachePath,
        filePath,
        hint,
        pkgInfo,
        runtimeAlias,
        type
      }

      const callback = () => compiler.compile(sourceCode, compilerOptions)
      cacheValue = pkgOptions.debug ? callback() : attempt(callback, manager, sourceCode)
    }
  }

  const tryModuleLoad = cacheValue.type === "module" ? tryESMLoad : tryCJSLoad
  tryModuleLoad.call(this, func, mod, cacheValue.code, filePath, runtimeAlias, pkgOptions)
}

function readCode(filePath, options) {
  return options.gz && _extname(filePath) === ".gz"
    ? gunzip(readFile(filePath), "utf8")
    : readFile(filePath, "utf8")
}

function tryCJSLoad(func, mod, code, filePath, runtimeAlias, options) {
  const exported = Object.create(null)
  const entry = Entry.get(mod, exported, options)

  code =
    "const " + runtimeAlias + "=this;" + runtimeAlias +
    ".r((function(exports,require,module,__filename,__dirname){" +
    code + "\n}),require)"

  setSourceType(exported, "script")
  Runtime.enable(mod, exported, options)

  tryModuleCompile.call(this, func, mod, code, filePath, options)
  Entry.set(mod.exports, entry.merge(Entry.get(mod, mod.exports, options)))

  if (options.cjs) {
    const getterPairs = keys(mod.exports)
      .map((key) => [key, () => mod.exports[key]])

    entry.addGetters(getterPairs)
  }

  mod.loaded = true
  entry.update().loaded()
}

function tryESMLoad(func, mod, code, filePath, runtimeAlias, options) {
  let async = ""
  const exported = Object.create(null)
  const moduleWrap = Module.wrap

  const customWrap = (script) => {
    Module.wrap = moduleWrap
    return '"use strict";(function(){const ' + runtimeAlias + "=this;" + script + "\n})"
  }

  if (allowTopLevelAwait && options.await) {
    allowTopLevelAwait = false
    if (process.mainModule === mod ||
        process.mainModule.children.some((child) => child === mod)) {
      async = "async "
    }
  }

  code =
    (options.cjs ? '"use strict";const ' + runtimeAlias + "=this;" : "") +
    runtimeAlias + ".r((" + async + "function(){" + code + "\n}))"

  if (! options.cjs) {
    Module.wrap = customWrap
  }

  setSourceType(exported, "module")
  Runtime.enable(mod, exported, options)

  try {
    tryModuleCompile.call(this, func, mod, code, filePath, options)
  } finally {
    if (Module.wrap === customWrap) {
      Module.wrap = moduleWrap
    }
  }
}

function tryModuleCompile(func, mod, code, filePath, options) {
  const moduleCompile = mod._compile
  const moduleReadFile = binding.internalModuleReadFile
  const readFileSync = fs.readFileSync

  let error
  let passthru = passthruMap.get(func)
  let restored = false

  const readAndRestore = () => {
    restored = true

    if (typeof moduleReadFile === "function") {
      binding.internalModuleReadFile = moduleReadFile
    }

    fs.readFileSync = readFileSync
    return code
  }

  const customModuleCompile = function (content, compilePath) {
    if (compilePath === filePath && ! restored) {
      // This fallback is only hit if the read file wrappers are missed,
      // which should never happen.
      content = readAndRestore()
    }

    mod._compile = moduleCompile
    return moduleCompile.call(this, content, compilePath)
  }

  const customModuleReadFile = function (readPath) {
    return readPath === filePath
      ? readAndRestore()
      : moduleReadFile.call(this, readPath)
  }

  const customReadFileSync = function (readPath, readOptions) {
    return readPath === filePath
      ? readAndRestore()
      : readFileSync.call(this, readPath, readOptions)
  }

  if (typeof internalModuleReadFile === "function") {
    // Wrap `process.binding("fs").internalModuleReadFile` in case future
    // versions of Node use it instead of `fs.readFileSync`.
    binding.internalModuleReadFile = customModuleReadFile
  }

  // Wrap `fs.readFileSync` to avoid an extraneous file read when the
  // unwrapped `Module._extensions[ext]` is called.
  fs.readFileSync = customReadFileSync

  // Wrap `mod._compile` in the off chance our read file wrappers are missed.
  mod._compile = customModuleCompile

  try {
    if (options.debug) {
      if (passthru) {
        func.call(this, mod, filePath)
      } else {
        mod._compile(code, filePath)
      }
      return
    }

    try {
      if (passthru) {
        func.call(this, mod, filePath)
      } else {
        mod._compile(code, filePath)
      }
    } catch (e) {
      error = e
    }

    if (passthru &&
        error && error.code === "ERR_REQUIRE_ESM") {
      error = passthru = false
      passthruMap.set(func, passthru)

      try {
        mod._compile(code, filePath)
      } catch (e) {
        error = e
      }
    }

    if (error) {
      throw maskStackTrace(error)
    }
  } finally {
    if (binding.internalModuleReadFile === customModuleReadFile) {
      binding.internalModuleReadFile = moduleReadFile
    }

    if (fs.readFileSync === customReadFileSync) {
      fs.readFileSync = readFileSync
    }

    if (mod._compile === customModuleCompile) {
      mod._compile = moduleCompile
    }
  }
}

const exts = Module._extensions
const extsJs = Wrapper.unwrap(exts, ".js")
const extsToWrap = [".js", ".gz", ".js.gz", ".mjs.gz", ".mjs"]

extsToWrap.forEach((key) => {
  if (typeof exts[key] !== "function") {
    // Mimic the built-in Node behavior of treating files with unrecognized
    // extensions as ".js".
    exts[key] = extsJs
  }

  Wrapper.manage(exts, key, managerWrapper)
  Wrapper.wrap(exts, key, methodWrapper)
  passthruMap.set(Wrapper.unwrap(exts, key), true)
})
