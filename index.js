const path = require('path');
const nodeFS = require('fs');

const clone   = require('lodash/lang').clone;
const unique  = require('lodash/array').uniq;
const flatten = require('lodash/array').flatten;
const compact = require('lodash/array').compact;

const SUPPORTED_FS_FUNCTIONS = new Map()
  .set('stat',     { returnFirstValue: true })
  .set('readFile', { returnFirstValue: true })
  .set('readlink', { returnFirstValue: true })
  .set('readdir', {
    returnFirstValue: false,

    mergeResults: (errors, results) => {
      if (compact(results).length === 0) {
        return [errors[0], undefined];
      } else {
        const result = unique(compact(flatten(results))).sort();
        return [undefined, result];
      }
    }
  });

function ensureStartsWithSlash(somepath) {
  if (somepath[0] === '.' && somepath[1] === '/') {
    // UGH, ideally no relative paths ever get here... right (currently from imports in a sass-loader?)
    somepath = somepath.slice(1);
  } else if (somepath[0] !== '/') {
    somepath = `/${somepath}`;
  }

  return somepath;
}

function ensureArray(possiblyArray) {
  if (!Array.isArray(possiblyArray)) {
    return [possiblyArray];
  } else {
    return possiblyArray;
  }
}


class MergedFileSystem {
  constructor(initialFilesystemsByMountPath) {
    this.mountedPaths = new Map;

    this.addMountPoints(initialFilesystemsByMountPath);

    for(let [funcName, funcOptions] of SUPPORTED_FS_FUNCTIONS) {
      this[funcName] = this._callAsyncFunc.bind(this, funcName, funcOptions);
      this[`${funcName}Sync`] = this._callSyncFunc.bind(this, `${funcName}Sync`, funcOptions);
    };
  }

  addMountPoints(newMountPoints) {
    const oldMountedPaths = this.mountedPaths;
    const mountPointsToAdd = {};

    // Create new map, instead of modifing existing one (to make sure we order
    // the map by most specific mount points first)
    this.mountedPaths = new Map();


    // Cleanup input
    for (let mountPath in newMountPoints) {
      if (newMountPoints.hasOwnProperty(mountPath)) {
        const newMountPath = ensureStartsWithSlash(mountPath);
        mountPointsToAdd[newMountPath] = ensureArray(newMountPoints[mountPath]);
      }
    }

    if (oldMountedPaths) {
      // Add existing mount points to new ones
      for (let [mountPath, filesystems] of oldMountedPaths.entries()) {
        if (mountPointsToAdd[mountPath]) {
          mountPointsToAdd[mountPath] = mountPointsToAdd[mountPath].concat(filesystems);
        } else {
          mountPointsToAdd[mountPath] = filesystems;
        }
      }
    }

    // Itereate over all the mount paths in reverse order (longest first)
    // and insert into our map (so we can rely on insertion order).
    Object.keys(mountPointsToAdd).sort().reverse().forEach(mountPath => {
      this.mountedPaths.set(mountPath, mountPointsToAdd[mountPath]);
    });
  }

  addMountPoint(newMountPoint, filesystem) {
    this.addMountPoints({
      [newMountPoint]: filesystem
    });
  }

  _gatherStuffToIterateOver(filepath) {
    const toIterateOver = [];

    // One loop to gather the all mountpaths and filesystems that match
    // (so we have a total to know when async calls are fully complete)
    for (let [mountPath, filesystems] of this.mountedPaths) {
      if (filepath.indexOf(mountPath) === 0) {
        let subpath;

        if (mountPath === '/') {
          subpath = filepath;
        } else {
          subpath = filepath.slice(mountPath.length);
        }

        for (let filesystem of filesystems) {
          let potentialSubpathAlias = subpath;
          let potentialAliasFS = undefined;

          // Treat "string" filesystems as simple "aliases" to some place on the
          // native filesystem
          if (typeof filesystem === 'string') {
            potentialSubpathAlias = path.join(filesystem, subpath);
            potentialAliasFS = filesystem;
            filesystem = nodeFS;
          }

          toIterateOver.push([
            mountPath,
            filesystem,
            potentialSubpathAlias,
            potentialAliasFS
          ])
        }
      }
    }

    return toIterateOver;
  }

  _iterateOverFilesystemsSync(filepath, iterCallback, doneCallback) {
    filepath = ensureStartsWithSlash(filepath);

    const toIterateOver = this._gatherStuffToIterateOver(filepath),
          collectedErrors = [],
          collectedResults = [];

    if (toIterateOver.length === 0) {
      throw new Error(`No mount points match: ${filepath}`);
    }

    for (let [i, [mountPath, filesystem, subpath, aliasIfExist]] of toIterateOver.entries()) {
      const iterResult = iterCallback(subpath, filesystem, mountPath);

      // sync iter func calls can return non-undefined value to stop iterating
      if (iterResult !== undefined) {
        return iterResult;
      }
    }
  }

  _iterateOverFilesystemsAsync(filepath, iterCallback, doneCallback) {
    filepath = ensureStartsWithSlash(filepath);

    const toIterateOver = this._gatherStuffToIterateOver(filepath),
          collectedErrors = [],
          collectedResults = [],
          self = this;

    let index = 0;

    function next(iterError, iterResult, stopIterating) {
      collectedErrors.push(iterError);
      collectedResults.push(iterResult);


      if (stopIterating || index === toIterateOver.length - 1) {
        doneCallback(
          collectedErrors.length > 0 ? collectedErrors : undefined,
          collectedResults
        );
      } else {
        index += 1;
        iterate();
      }
    }

    function iterate() {
      const [mountPath, filesystem, subpath, aliasIfExist] = toIterateOver[index];
      iterCallback(subpath, filesystem, mountPath, next);
    }

    if (toIterateOver.length > 0) {
      iterate();
    } else {
      console.error(`No mount points match: ${filepath}`)
      doneCallback(new Error(`No mount points match: ${filepath}`), undefined);
    }
  }

  _callAsyncFunc(funcName, funcOptions, filepath, ...otherArgs) {
    const errors = [],
          results = [],
          callback = otherArgs.pop()

    let stoppedEarly = false;

    this._iterateOverFilesystemsAsync(filepath, (subpath, filesystem, mountPath, next) => {
      if (!filesystem[funcName]) {
        next(new Error('filessytem has no such function: ' + funcName));
      } else {

        filesystem[funcName](subpath, ...otherArgs, (error, result) => {
          errors.push(error);  // TODO, do something with these?
          results.push(result);

          if (error) {
            next(error);
          } else if (result !== undefined) {
            if (funcOptions.returnFirstValue) {
              callback(undefined, result);

              stoppedEarly = true;
              next(error, result, true);  // final true to stop iterating
            } else {
              next(error, result);
            }
          }
        })
      }
    }, function doneIteration() {
      if (funcOptions.mergeResults) {
        const [mergedError, mergedResult] = funcOptions.mergeResults(errors, results);
        callback(mergedError, mergedResult);

      } else if (!stoppedEarly) {
        // If we fell through the whole way and all were errors, make sure we call
        // the callback with some error (pass them all? just the first/last one?)
        callback(errors[0], undefined);
      }


    });

  }

  _callSyncFunc(funcName, funcOptions, filepath) {
    const errors = [],
          results = [];

    const finalResult = this._iterateOverFilesystemsSync(filepath, (subpath, filesystem, mountPath) => {
      if (filesystem[funcName]) {
        let result, error;

        try {
          result = filesystem[funcName](subpath);
        } catch (e) {
          error = e;
        }

        results.push(result);
        errors.push(error);

        if (funcOptions.returnFirstValue && result !== undefined) {
          return result;
        }
      }
    });

    if (funcOptions.mergeResults) {
      const [mergedError, mergedResult] = funcOptions.mergeResults(errors, results);

      if (mergedResult === undefined && mergedError) {
        throw mergedError;
      } else {
        return mergedResult;
      }
    } else if (finalResult === undefined) {
      // it should have returned earlier, must have only been errors, so throw
      // throw errors;
      throw errors[0];
    } else {
      return finalResult;
    }
  }

}

/* Creates a proxy fs object (mimicing the node fs API) that merges together
   multiple filesystem instances and/or paths at different parts of the actual filesystem.

      createMergedFileSystem({
        "/": require('fs'),  // fallthrough to the native filesystem

        // point a "mount point" to a specific FS impl
        "/mount-point-1": customFSInstance,

        // make an alias, so that `/an-alias/dir/file.txt` ends up hitting `/some/path/file.txt`
        "/an-alias: "/some/path",

        // have fallbacks for a specific mount point
        "/another-mount-point": [
          customFSInstance2,
          customFSInstance3,
          "/some/fs/path"
        ]
      });

  Only supports the following node FS APIs so far (both sync and async):
    - stat
    - readdir
    - readFile
    - readlink

  And by default, all of those functions will return the first successful result.
  However, `readdir` will merge all the successful results together into a single
  array.


  NOTE, intentially completely ignoring windows paths and using unix-style paths (for now?)
*/
function createMergedFileSystem(filesystemsByMountPath) {
  return new MergedFileSystem(filesystemsByMountPath);
}

module.exports = createMergedFileSystem;

