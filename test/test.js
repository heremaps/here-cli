var assert = require('assert');
const expect = require('chai').expect;
// var nrc = require('node-run-cmd');
var mock = require('mock-require');
var rewire = require("rewire");
var server = require('./server');
var capcon = require('capture-console');


// describe('Installation', function () {
//   describe('VersionCheck', function () {
//     it('should return 0 as the exit code for version check', async function () {
//       this.timeout(10000);
//       await nrc.run('chmod 777 ./bin/here.js');
//       const ecodes = await nrc.run('./bin/here.js --version');
//       assert.equal(0, ecodes[0]);
//     });
//   });
// });

describe('Configure', function () {
  describe('configure', function () {
    var count = 0;
    before(function () {
      server.listen();
      mock('user-settings', {
        file: function (a) {
          return {
            get: function (keyName) {
              return "true";
            },
            set: function () {
            }
          }
        }
      });
      let option = function () {
        return {
          option: option,
          action: option,
          description: option,
          alias: option,
          command: option,
          version: option,
          parse: option
        };
      }
      mock('commander', {
        version:option,
        help: option,
        parse: option,
        command: option
      }
      );
    });
    it('should authenticate appid/appcode properly', async function () {
      count++;
      // mock('prompt', 
      //     {
      //        get: function(a,b) {
      //            console.log(b);
      //            let result = [];
      //            result['AppId']='test';
      //            result['AppCode']='test123';
      //            console.log(b(null,result));
      //         },
      //         start: function() {
      //           console.log('start called');
      //         },
      //         stop: function() {
      //           console.log('end called');
      //         }
      //     });
      //const prompter = require('prompt');
      // const configure = rewire('../bin/here-configure');
      // const setAuth = configure.__get__('setAuth');
      // console.log(setAuth({}));
      const common = require('../bin/common');
      common.xyzRoot = () => "http://localhost:3578";
      const { esponse, authId, authSecret } = await common.login("abcd", "secret");
      assert.equal("abcd", authId);
      assert.equal("secret", authSecret);
      count--;
    });

    it('should authenticate userName/password properly', async function () {
      count++;
      const common = rewire('../bin/common');
      common.__get__('sso').executeWithCookie = function () {
        return new Promise((res, rej) => {
          res("myCookie");
        })
      }
      common.xyzRoot = () => "http://localhost:3578";
      const token = await common.hereAccountLogin("abcd", "secret");
      assert.equal("myCookie", token);
      count--;
    });

    it('list all spaces', async function () {
      //sh.exec('chmod 777 ./bin/here.js');
      
      const xyz = rewire('../bin/here-xyz');
      xyz.__get__('common').verify=function(){
        return "testtoken";
      }
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('listSpaces')({ raw: false, prop: [] });
      capcon.stopCapture(process.stdout);
      if (output.indexOf("oQ8SICzO") != -1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    it('describe space', async function () {
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      let features = await xyz.__get__('getSpaceDataFromXyz')("myspace", { raw: false, prop: [] });
      summary.summarize(features,"myspace", false);
      capcon.stopCapture(process.stdout);
      if (features.length>0) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
      if (output.indexOf("groupkey@bel;daily;poi")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    it('analyze space', async function () {
      mock('inquirer', {
          prompt:function(){
            return new Promise((res,rej)=>{
              res({properties:['ruleId']});
            });
          }
        }
      );
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('analyzeSpace')("myspace", { raw: false, prop: [] });
      capcon.stopCapture(process.stdout);      
      if (output.indexOf("ruleId        ADD029  2")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    it('show space', async function () {
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('showSpace')("myspace", { raw: false, prop: [] });
      capcon.stopCapture(process.stdout);     
      if (output.indexOf("9376020521  MultiLineString  workspace@weu_bw_1901")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });
    it('delete space', async function () {
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('deleteSpace')("myspace", { raw: false, prop: [] });
      capcon.stopCapture(process.stdout); 
      if (output.indexOf("xyzspace 'myspace' deleted successfully")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });
    it('create space', async function () {
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('createSpace')({ title: "test", message : "test" });
      capcon.stopCapture(process.stdout); 
      if (output.indexOf("xyzspace 'testing' created successfully")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });
    it('clear space', async function () {
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('clearSpace')("myspace", { tags:"*" });
      capcon.stopCapture(process.stdout); 
      if (output.indexOf("data cleared successfully")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    it('list space tokens', async function () {
      const xyz = rewire('../bin/here-xyz');
      xyz.__get__('common').decryptAndGet=async function(info){
        console.log("info is"+info);
        return "x%%y";
      };
      xyz.__get__('sso').executeWithCookie=async function(a,b){
        return "x%%y";
      };
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('listTokens')();
      capcon.stopCapture(process.stdout); 
      if (output.indexOf("Current CLI token is : x%%y")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
      if (output.indexOf("a   b     c    d")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });
    
    it('upload to space using geojson', async function () {
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('uploadToXyzSpace')("myspace", { file: "test/data/sample.geojson"});
      capcon.stopCapture(process.stdout);     
      if (output.indexOf("data upload to xyzspace 'myspace' completed successfully")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }

      if (output.indexOf("Unique tag list  :[\"sample\"]")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    

    it('upload to space using csv', async function () {
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('uploadToXyzSpace')("myspace", { file: "test/data/sample.csv"});
      capcon.stopCapture(process.stdout);     
      if (output.indexOf("data upload to xyzspace 'myspace' completed successfully")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
      console.log(output);
      if (output.indexOf("Unique tag list  :[\"sample\"]")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
      if (output.indexOf("sample   1")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    it('upload to space using shapefile', async function () {
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('uploadToXyzSpace')("myspace", { file: "test/data/shapesample/shapesample.shp"});
      capcon.stopCapture(process.stdout);     
      if (output.indexOf("data upload to xyzspace 'myspace' completed successfully")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
      if (output.indexOf("Unique tag list  :[\"shapesample\"]")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
      if (output.indexOf("Total 86 features")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    it('upload to space using geojson using stream', async function () {
      this.timeout(10000);
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('uploadToXyzSpace')("myspace", { file: "test/data/sample.geojson",stream:true});
      capcon.stopCapture(process.stdout);     
      if (output.indexOf("uploaded feature count :2, failed feature count :0")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    it('upload to space using csv using stream', async function () {
      this.timeout(10000);
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('uploadToXyzSpace')("myspace", { file: "test/data/sample.csv",stream:true});
      capcon.stopCapture(process.stdout);     
      if (output.indexOf("uploaded feature count :1, failed feature count :0")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });
    it('upload to space using geojsonl', async function () {
      this.timeout(10000);
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('uploadToXyzSpace')("myspace", { file: "test/data/sample.geojsonl"});
      capcon.stopCapture(process.stdout);     
      console.log("output::::"+output);
      if (output.indexOf("data upload to xyzspace 'myspace' completed successfully")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });
    it('upload to space using geojsonl using stream', async function () {
      this.timeout(10000);
      const xyz = rewire('../bin/here-xyz');
      const summary = rewire('../bin/summary');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('uploadToXyzSpace')("myspace", { file: "test/data/sample.geojsonl",stream:true});
      capcon.stopCapture(process.stdout);     
      if (output.indexOf("uploaded feature count :2, failed feature count :0")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });

    it('test here geocoder', async function () {      
      const requestAsync = require('../bin/requestAsync');
      requestAsync.requestAsync=async function(){
        return {response:{statusCode:200},body:JSON.stringify({ "Response": { "MetaInfo": { "Timestamp": "2016-02-15T10:33:55.504+0000" }, "View": [ { "_type": "SearchResultsViewType", "ViewId": 0, "Result": [ { "Relevance": 1, "MatchLevel": "houseNumber", "MatchQuality": { "State": 1, "City": 1, "Street": [ 0.9 ], "HouseNumber": 1 }, "MatchType": "pointAddress", "Location": { "LocationId": "NT_nL.dzNwdSJgdcF4U8dYEiC_yADM", "LocationType": "address", "DisplayPosition": { "Latitude": 37.37634, "Longitude": -122.03405 }, "NavigationPosition": [ { "Latitude": 37.37643, "Longitude": -122.03444 } ], "MapView": { "TopLeft": { "Latitude": 37.3774642, "Longitude": -122.0354646 }, "BottomRight": { "Latitude": 37.3752158, "Longitude": -122.0326354 } }, "Address": { "Label": "200 S Mathilda Ave, Sunnyvale, CA 94086, United States", "Country": "USA", "State": "CA", "County": "Santa Clara", "City": "Sunnyvale", "District": "Heritage District", "Street": "S Mathilda Ave", "HouseNumber": "200", "PostalCode": "94086", "AdditionalData": [ { "value": "United States", "key": "CountryName" }, { "value": "California", "key": "StateName" }, { "value": "Santa Clara", "key": "CountyName" }, { "value": "N", "key": "PostalCodeType" } ] } } } ] } ] } })};
      }
      const xyz = rewire('../bin/here-geocode');
      var output = '';
      capcon.startCapture(process.stdout, function (stdout) {
        output += stdout;
      });
      await xyz.__get__('geoCode')("mumbai");
      capcon.stopCapture(process.stdout);     
      if (output.indexOf("\"Label\": \"200 S Mathilda Ave, Sunnyvale, CA 94086, United States\"")!=-1) {
        assert.ok(true, "");
      } else {
        assert.fail();
      }
    });
    

    after(async function () {
      server.close();
    })
  });

});
