## merged-fs

Take several separate node filesystem implementations or filesystem aliases, and merges them into a single object that mimics the regular 'ol node `fs` module.

I put together as prototype to merge several Webpack [MemoryFileSystems](https://github.com/webpack/memory-fs), so it is easier to use other code that directly relies on the node filesystem. It works, and is decently tested, but still early. Oh, and I'm assuming >= node 6.x for now.


### Usage

```js
const mergedFS = createMergedFileSystem({
  // Point a "mount point" to a specific filesystem impl, meaning that
  // `mergedFS.statSync('/mount-point-1/file.txt')` will end up calling
  // `customFSInstance.statSync('/file.txt')`
  "/mount-point-1": customFSInstance,

  // Make an alias, so that `/an-alias/dir/file.txt` ends up hitting `/some/path/dir/file.txt`
  // on the native filesystem
  "/an-alias": "/some/path",

  // Have fallbacks for a specific mount point
  "/another-mount-point": [
    customFSInstance2,
    customFSInstance3,
    "/some/fs/path"
  ],

  // Custom filesystem with an alias, so `/custom-fs-with-alias/dir/file.txt` will
  // hit `/teh-alias/dir/file.txt` of customFSInstance4
  "/custom-fs-with-alias": {
    alias: "teh-alias",
    filesystem: customFSInstance4
  },

  "/": "/",  // fallthrough to the native filesystem
  // OR 
  // "/": require('fs')
});
```

#### Details

So far, this only supports the following node filesystem APIs so far (both sync and async):
  - stat
  - readdir
  - readFile
  - readlink

And by default, all of those functions will return the first successful result after iterating through all the filesystems (in order of most to least specific). However, `readdir` will merge all the successful results together into a single array (representing all the files in any directory of a matching filesystem).

NOTE, intentionally completely ignoring windows paths and using unix-style paths (for now?)
