### merged-fs

Take several separate node filesystem implementations or filesystem aliases, and merges them into a single object that mimics the regular 'ol node `fs` module.

I put together as prototype to merge several Webpack [MemoryFileSystems](https://github.com/webpack/memory-fs), so it is easier to use other code that directly relies on the node filesystem. It works, and is decently tested, but still early. Oh, and I'm assuming >= node 6.x for now.
