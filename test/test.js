var path = require('path');
var nodefs = require('fs');
var should = require('should');

var createMergedFileSystem = require('../index');

var tempDir = '/tmp/temp-MergedFS';
var tempFilename = 'test-file.txt';
var tempFilepath = path.join(tempDir, tempFilename);

describe('MergedFS', () => {
  beforeEach(() => {
    nodefs.mkdirSync(tempDir);
    nodefs.writeFileSync(tempFilepath, 'foobar');
  });

  afterEach(() => {
    nodefs.unlinkSync(tempFilepath);
    nodefs.rmdirSync(tempDir);
  });

  describe('root fallthrough', () => {
    beforeEach(() => {
      this.fs = createMergedFileSystem({
        "/": require('fs')
      });
    });

    it('should read files synchronously', () => {
      var content = this.fs.readFileSync(tempFilepath).toString();
      content.should.be.a.String();
      content.length.should.be.greaterThan(0);
    });

    it('should read files asynchronously', (done) => {
      this.fs.readFile(tempFilepath, (err, result) => {
        var content = result.toString();
        content.should.be.a.String();
        content.length.should.be.greaterThan(0);
        done();
      });
    });

    it('should stat files synchronously', () => {
      var stats = this.fs.statSync(tempFilepath)
      stats.should.be.ok();
      stats.isFile().should.be.true();
    });

    it('should stat files asynchronously', (done) => {
      this.fs.stat(tempFilepath, (err, stats) => {
        stats.should.be.ok();
        stats.isFile().should.be.true();
        done();
      });
    });

    it('should read dirs synchronously', () => {
      var files = this.fs.readdirSync(tempDir);
      files.should.be.an.Array();
      files.should.match([
        tempFilename
      ]);
    });

    it('should read dirs asynchronously', (done) => {
      this.fs.readdir(tempDir, (err, files) => {
        files.should.be.an.Array();
        files.should.match([
          tempFilename
        ]);
        done();
      });
    });

  });



  describe('string alias', () => {
    beforeEach(() => {
      this.fs = createMergedFileSystem({
        "/": tempDir
      });
    });

    it('should be accessed by path subset', () => {
      var content = this.fs.readFileSync(tempFilename).toString();
      content.should.be.a.String();
    });
  });

  describe('multiple fs fallthrough', () => {
    beforeEach(() => {
      this.fs = createMergedFileSystem({
        "/fallthrough": ["/NOT REAL", tempDir]
      });
    });

    it('should be accessed by path subset', () => {
      var content = this.fs.readFileSync(path.join("/fallthrough", tempFilename)).toString();
      content.should.be.a.String();
    });
  });

  describe('multiple mount point fallthrough', () => {
    beforeEach(() => {
      this.fs = createMergedFileSystem({
        "/tmp": "/NOT REAL",
        "/": nodefs
      });
    });

    it('should be accessed despite failure in earlier mount point', () => {
      var content = this.fs.readFileSync(tempFilepath).toString();
      content.should.be.a.String();
    });
  });

  describe('can be incrementally created', () => {
    before(() => {
      this.fs = createMergedFileSystem({});
    });

    it('add first mount point later', () => {
      this.fs.addMountPoints({
        "/": tempDir
      });

      var content = this.fs.readFileSync(tempFilename).toString();
      content.should.be.a.String();

      // Ensure it doesn't fallthrough to the real fs
      console.log("this.fs.mountedPaths", this.fs.mountedPaths);
      should.throws(() => this.fs.statSync(__dirname).isDirectory().should.be.true());
    });

    it('add another mount point', () => {
      this.fs.addMountPoint("/fallthrough", ["/NOT REAL", tempDir]);

      var content = this.fs.readFileSync(tempFilename).toString();
      content.should.be.a.String();

      var content = this.fs.readFileSync(path.join("/fallthrough", tempFilename)).toString();
      content.should.be.a.String();
    });

    it('add yet another mount point, included one that merges with a previous one', () => {
      this.fs.addMountPoints({
        "/tmp": "/NOT REAL",
        "/": nodefs
      });

      var content = this.fs.readFileSync(tempFilename).toString();
      content.should.be.a.String();

      var content = this.fs.readFileSync(path.join("/fallthrough", tempFilename)).toString();
      content.should.be.a.String();

      var content = this.fs.readFileSync(tempFilepath).toString();
      content.should.be.a.String();

      // Ensure it does fallthrough to the real fs now (since there are multiple
      // filesystems attached to `/`)
      this.fs.statSync(__dirname).isDirectory().should.be.true();
    });
  });

  describe('custom filesystems', () => {
    beforeEach(() => {
      this.fs = createMergedFileSystem({
        "/custom": [{
          readdirSync: function(filepath) {
            return ["FOOBAR", "YEAH, not a real FS..."]
          },

          readdir: function(filepath, callback) {
            callback(undefined, ["FOOBAR", "YEAH, not a real FS..."]);
          }
        }, {
          readdirSync: function(filepath) {
            return ["Allo", "FOOBAR"]
          },

          readdir: function(filepath, callback) {
            callback(undefined, ["Allo", "FOOBAR"]);
          }
        }]
      });
    });

    it('should readdir synchronously (and merge files)', () => {
      var files = this.fs.readdirSync(path.join('/custom', tempDir));
      files.should.be.an.Array();
      files.should.match(["Allo", "FOOBAR", "YEAH, not a real FS..."]);
    });

    it('should readdir asynchronously (and merge files)', (done) => {
      var files = this.fs.readdir(path.join('/custom', tempDir), (error, files) => {
        files.should.be.an.Array();
        files.should.match(["Allo", "FOOBAR", "YEAH, not a real FS..."]);
        done()
      });
    });

  });

  describe('custom filesystems with errors', () => {
    beforeEach(() => {
      this.fs = createMergedFileSystem({
        "/custom with errors": [{
          readdirSync: function(filepath) {
            throw new Error('Nice try');
          },

          readdir: function(filepath, callback) {
            throw new Error('Nice try');
          }
        }, {
          readdirSync: function(filepath) {
            throw new Error('Nice try');
          },

          readdir: function(filepath, callback) {
            throw new Error('Nice try');
          }
        }]
      });
    });


    it('should throw an error synchronously', () => {
      should.throws(() => this.fs.readdirSync(path.join('/custom with errors', tempDir)));
    });

    // Throws syncrhonously???
    it.skip('should call async callbak with errors', (done) => {
      var files = this.fs.readdir(path.join('/custom with errors', tempDir), (error, files) => {
        error.message.should.be.equal('Nice try');
      });
    });

  });

  describe('multiple mount point fallthrough', () => {
    beforeEach(() => {
      this.fs = createMergedFileSystem({
        "/many but all broken": ["/fake 1", "/fake 2", "/fake 3"],
        "/": "/still not here"
      });
    });

    it('should throw synchronously', () => {
      should.throws(() => this.fs.statSync('/many but all broken/NUTHIN'));
    });

    it('should call async callback with several errors', () => {
      this.fs.stat('/many but all broken/NUTHIN', (errors) => {
        errors.length.should.be.equal(4);
      });
    });
  });

});
