#!/usr/bin/env node

/*
  Copyright (C) 2018 HERE Europe B.V.
  SPDX-License-Identifier: MIT

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  'Software'), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

var program = require('commander');
var inquirer = require('inquirer');
var request = require('request');
var common = require('./common');
var sso = require('./sso');
var summary = require('./summary');
var transform = require('./transformutil');
var zlib = require('zlib');
var choiceList = [];
var questions = [
  {
    type: 'checkbox',
    name:'tagChoices',
    message:'Select attributes which needs to be added as tags like key@value',
    choices:choiceList
  },
  {
    type: 'checkbox',
    name: 'idChoice',
    message: 'Select attributes which would be used as Id, please note that ID field has to be unique',
    choices:choiceList
  }
];

var questionAnalyze = [
  {
    type: 'checkbox',
    name:'properties',
    message:'Select the properties to analyze',
    choices:choiceList
  }
];

program
  .version('0.1.0');


function getGeoSpaceProfiles(title, description) {
  return {
    "title": title,
    "description": description
  };
}

function execInternal(uri, method, contentType, data, token, onSuccess, onFailure,gzip) {
  if(gzip){
    execInternalGzip(uri, method, contentType, data, token, onSuccess, onFailure);
  }else{ 
    var isJson = (contentType == "application/json") ? true : false;
    var reqJson = {
      url: common.xyzRoot() + uri,
      method: method,
      json: isJson,
      headers: {
        "Authorization": "Bearer "+token,
        'Content-Type': contentType
      }
    };
    if("GET"!=method){
      reqJson.body=data;
    }
    request(reqJson,
      function (error, response, body) {
        var statusCode = response && response.statusCode;
        processBody(statusCode,error,body,onSuccess,onFailure);
    });
  }
}

function execInternalGzip(uri, method, contentType, data, token, onSuccess, onFailure) {
  zlib.gzip(data, function (error, result) {
   if (error) throw error;
   
  var isJson = (contentType == "application/json") ? true : false;
  var reqJson = {
    url: common.xyzRoot() + uri,
    method: method,
    json: isJson,
    headers: {
      "Authorization": "Bearer "+token,
      'Content-Type': contentType,
      'Content-Encoding': 'gzip',
      'Accept-Encoding': 'gzip'
    },
    gzip: true
  };
  if("GET"!=method){
    reqJson.body=result;
  }
  request(reqJson,
    function (error, response, body) {
      var statusCode = response && response.statusCode;
      processBody(statusCode,error,body,onSuccess,onFailure);
    });
  });

}

function processBody(statusCode,error,body,onSuccess,onFailure){
  if (statusCode > 210 || statusCode < 200 ) {
        var errorObj = { error: error, body: JSON.stringify(body), statusCode: statusCode };
        onFailure(errorObj);
  } else {
        onSuccess(body);
  }
}

Object.resolve = function (path, obj) {
  return path.split('.').reduce(function (prev, curr) {
    return prev ? prev[curr] : undefined
  }, obj || self)
}

function execute(uri, method, contentType, data, onSuccess, onFailure,gzip) {
  common.verify(function (request, token) {
    execInternal(uri, method, contentType, data, token, function (body) {
      onSuccess(body)
    }, function (errorObj) {
      if (onFailure) {
        onFailure(errorObj);
      } else {
        console.log("Command Failure :" + errorObj.body)
      }
    },gzip);
  }, function () {

  });
}

program
  .command('list')
  .alias('ls')
  .description('information about available xyz spaces')
  .option("-r, --raw", "show raw xyzspace definition")
  .option("-p, --prop <prop>", "property fields to include in table", collect, [])
  .action(function (options) {
    var uri = "/hub/spaces";
    var cType = "application/json";
    var tableFunction = common.drawTable;
    if (options.raw) {
      tableFunction = function (data, columns) {
        try {
          console.log(JSON.stringify(JSON.parse(data), null, 2));
        } catch (e) {
          console.log(JSON.stringify(data, null, 2));
        }
      }
    }
    // console.log(uri);
    execute(uri, "GET", cType, "", function (body) {
      if(body.length==0){
        console.log("No xyzspace found");
      }else{
        var fields = ['id', 'title', 'description'];
        if (options.prop.length > 0) {
          fields = options.prop;
        }
        tableFunction(body, fields);
      }
    }, function (errorObj) {
      console.log("Command Failure :" + errorObj.body);
    });
  });

function collect(val, memo) {
  memo.push(val);
  return memo;
}

program
  .command('describe <id>')
  .description('shows the content of the given [id]')
  .option("-l, --limit <limit>", "Number of objects to be fetched")
  .option("-h, --handle <handle>", "The handle to continue the iteration")
  .option("-t, --tags <tags>", "Tags to filter on")
  .option("-p, --token <token>", "a external token to access space")
  .action(function (id, options) {
    var cType = "application/json";
    if (!options.limit) {
      options.limit = 5000;
    }
    var getUrI =function(handle){
      var uri = "/hub/spaces/" + id;
      var spFunction = "iterate";
      if (options.limit) {
        uri = uri + "/"+spFunction+"?limit=" + options.limit;
        if (handle) {
          uri = uri + "&handle=" + handle;
        }
        if (options.tags) {
          uri = uri + "&tags=" + options.tags;
        }
        cType = "application/geo+json";
      }
      return uri;
    }
    const totalRecords = 500000;
    var recordLength = 0;
    let features = new Array();
    (async () => {

      try{
        var cHandle=0;
        process.stdout.write("Operation may take a while. Please wait .....");
        do{
          process.stdout.write(".");
          let body = await executeWithPromise(getUrI(cHandle), "GET", cType, "",null,null,"gzip",options.token);
          var jsonOut=JSON.parse(body);
          cHandle=jsonOut.handle;
          if(jsonOut.features){
            recordLength +=jsonOut.features.length;
            features=features.concat(jsonOut.features);
          }else{
            cHandle=-1;
          }
        }while(cHandle>=0 && recordLength<totalRecords);
        process.stdout.write("\n");
        summary.summarize(features,id);
      } catch (error) {
        console.error(`describe failed: ${error}`);
      }
    })();
  });


  program
  .command('analyze <id>')
  .description('shows the content of the given [id]')
  .option("-l, --limit <limit>", "Number of objects to be fetched")
  .option("-h, --handle <handle>", "The handle to continue the iteration")
  .option("-t, --tags <tags>", "Tags to filter on")
  .option("-p, --token <token>", "a external token to access space")
  .action(function (id, options) {
    var cType = "application/json";
    if (!options.limit) {
      options.limit = 5000;
    }
    var getUrI =function(handle){
      var uri = "/hub/spaces/" + id;
      var spFunction = "iterate";
      if (options.limit) {
        uri = uri + "/"+spFunction+"?limit=" + options.limit;
        if (handle) {
          uri = uri + "&handle=" + handle;
        }
        if (options.tags) {
          uri = uri + "&tags=" + options.tags;
        }
        cType = "application/geo+json";
      }
      return uri;
    }
    const totalRecords = 500000;
    var recordLength = 0;
    let features = new Array();
    (async () => {

      try{
        var cHandle=0;
        process.stdout.write("Operation may take a while. Please wait .....");
        do{
          process.stdout.write(".");
          let body = await executeWithPromise(getUrI(cHandle), "GET", cType, "",null,null,"gzip",options.token);
          var jsonOut=JSON.parse(body);
          cHandle=jsonOut.handle;
          if(jsonOut.features){
            recordLength +=jsonOut.features.length;
            features=features.concat(jsonOut.features);
          }else{
            cHandle=-1;
          }
        }while(cHandle>=0 && recordLength<totalRecords);
        process.stdout.write("\n");
        
        createQuestionsList({features:features});
        var propertiess=null;
        inquirer.prompt(
          questionAnalyze
        ).then(answers => {
          properties = answers.properties;
          if(properties && properties.length>0){
            summary.analyze(features,properties,id);
          }else{
            console.log("No property selected to analyze");
          }
        });
      } catch (error) {
        console.error(`describe failed: ${error}`);
      }
    })();
  });

program
  .command('show <id>')
  .description('shows the content of the given [id]')
  .option("-l, --limit <limit>", "Number of objects to be fetched")
  .option("-h, --handle <handle>", "The handle to continue the iteration")
  .option("-t, --tags <tags>", "Tags to filter on")
  .option("-r, --raw", "show raw xyzspace content")
  .option("-p, --prop <prop>", "property fields to include in table", collect, [])
  .option("-w, --web", "display xyzspace on http://geojson.tools")
  .action(function (id, options) {
    var uri = "/hub/spaces";
    var cType = "application/json";
    var tableFunction = common.drawTable;

    uri = uri + "/" + id;

    if (options.raw) {
      tableFunction = function (data, columns) {
        try {
          console.log(JSON.stringify(JSON.parse(data), null, 2));
        } catch (e) {
          console.log(JSON.stringify(data, null, 2));
        }
      }
    }

    cType = "application/geo+json";
    if (!options.limit) {
      options.limit = 5000;
    }
    var spFunction = options.handle?"iterate":"search";
    if (options.limit) {
      uri = uri + "/"+spFunction+"?limit=" + options.limit;
      if (options.handle) {
        uri = uri + "&handle=" + options.handle;
      }
      if (options.tags) {
        uri = uri + "&tags=" + options.tags;
      }
      cType = "application/geo+json";
    }
    if(options.web){
      launchHereGeoJson(uri);
    }else{
      execute(uri, "GET", cType, "", function (body) {
        var fields = ['id', 'geometry.type', 'tags','createdAt','updatedAt'];
        var allFeatures =  JSON.parse(body).features;
        if(!options.raw){
          allFeatures.forEach(element => {
            element.tags = element.properties["@ns:com:here:xyz"].tags;
            element.updatedAt = common.timeStampToLocaleString(element.properties["@ns:com:here:xyz"].updatedAt);
            element.createdAt = common.timeStampToLocaleString(element.properties["@ns:com:here:xyz"].createdAt);
          });
        }
        if (options.prop.length > 0) {
          fields = options.prop;
        }
        tableFunction( options.raw ? body :allFeatures, fields);
      }, function (errorObj) {
        console.log("Command Failure :" + errorObj.body);
      });
    }
  });

program
  .command('delete <id>')
  .description('delete the xyzspace with the given id')
  .action(function (geospaceId) {
    //console.log("geospaceId:"+"/geospace/"+geospaceId);

    execute("/hub/spaces/" + geospaceId, "DELETE", "application/json", "", function (body) {
      console.log("xyzspace '" + geospaceId + "' deleted successfully");
    }, function (errorObj) {
      console.log("Command Failure :" + errorObj.body);
    });
  });


program
  .command('create')
  .description('create a new xyzspace')
  // .option("-tmin, --tileMinLevel [tileMinLevel]", "Minimum Supported Tile Level")
  // .option("-tmax, --tileMaxLevel [tileMaxLevel]", "Maximum Supported Tile Level")
  .option("-t, --title [title]", "Title for xyzspace")
  .option("-d, --message [message]", "Short description ")
  .option('-p, --profile [profile]', 'Select a profile')
  .action(function (options) {
    if (options) {
      if (!options.title) {
        options.title = "a new xyzspace created from commandline";
      }
      if (!options.message) {
        options.message = "a new xyzspace created from commandline";
      }
    }
    var gp = getGeoSpaceProfiles(options.title, options.message);
    execute("/hub/spaces/", "POST", "application/json", gp, function (body) {
      console.log("xyzspace '" + body.id + "' created successfully");
    });
  });


  program
  .command('clear')
  .description('clear data from xyz space')
  .option("-t, --tags [tags]", "tags for the xyz space")
  .option("-i, --ids [ids]", "ids for the xyz space")
  .action(function (id, options) {
    if (!options.ids && !options.tags) {
      console.log("At least -t or -i should be provided as a query parameter.");
      process.exit(1);
    }
    var tagOption =options.tags?options.tags.split(",").filter(x=>!"").map(x=>"tags="+x).join("&"):"";
    if(tagOption!="") {
      tagOption+="&";
    }
    let idOption =options.ids?options.ids.split(",").filter(x=>!"").map(x=>"id="+x).join("&"):"";
    
    let finalOpt = tagOption+idOption;

    //console.log("/hub/spaces/"+id+"/features?"+deleteOptions);
    execute("/hub/spaces/"+id+"/features?"+finalOpt, "DELETE", "application/geo+json", null, function (body) {
      console.log("data cleared successfully.");
    });
  });

  program
  .command('token')
  .description('list all xyz token ')
  .action(function (id) {
    common.decryptAndGet("accountInfo","No here account configure found. Try running 'here configure account'").then((dataStr) =>{
      if(dataStr){
          const appInfo = common.getSplittedKeys(dataStr);
          if(appInfo){
            sso.executeWithCookie(appInfo[0],appInfo[1]).then(cookie=>{
                  const options = { 
                      url: common.xyzRoot()+"/token-api/token",
                      method: 'GET',
                      headers: {
                          "Cookie":cookie,
                          "Content-Type":"application/json"
                      }
                  };
                  return new Promise(function(resolve, reject) {
                      request(options, function(error, response, body) {
                          var statusCode = response && response.statusCode;
                          if (statusCode != 200) {
                              reject(new Error("Error while fetching maxrights :"+body));
                          }else{
                              var tokenInfo = JSON.parse(body);
                              common.decryptAndGet("keyInfo","No token found").then((currentToken) =>{
                                console.log("====================================================");
                                console.log("Current CLI token is : "+currentToken);
                                console.log("====================================================");
                                common.drawTable(tokenInfo.tokens,["id","type","iat","description"]);
                              });
                          }
                      });
                  });
            });
          }else{
            console.log("Account information needs to be updated. Retry after executing the command 'here configure account'.");
          }
       }
    });  
  });

program
  .command('upload <id>')
  .description('upload a local geojson file to the given id')
  .option('-f, --file <file>', 'geojson file to upload')
  .option('-c, --chunk [chunk]', 'chunk size')
  .option('-t, --tags [tags]', 'tags for the xyz space')
  .option('-x, --lon [lon]', 'longitude field name')
  .option('-y, --lat [lat]', 'latitude field name')
  .option('-z, --alt [alt]', 'altitude field name')
  .option('-p, --ptag [ptag]', 'property names to be used to add tag')
  .option('-i, --id [id]', 'property name(s) to be used as the feature ID')
  .option('-a, --assign', 'list the sample data and allows you to assign fields which needs to be selected as tags')
  .option('-u, --unique', 'option to enforce uniqueness to the id by creating a hash of feature and use that as id')
  .option('-o, --override', 'override the data even if it share same id')
  .action(function (id, options) {
    var tags = "";
    if(options.tags){
	    tags=options.tags;
    }
    //Default chunk size set as 200
    if(!options.chunk){
      options.chunk = 200;
    }

    if(options.unique && options.override){
      console.log("conflicting options together. You may need to use either unique or override. Refer to 'here xyz upload -h' for help");
      process.exit(1);
    }else if (!options.override){
      options.unique=true;
    }

    if (options.file) {
      var fs = require('fs');
      if(options.file.indexOf(".geojsonl")!=-1){
        transform.readLineFromFile(options.file,function(result,isCompleted){
          const totalFeatures = result.reduce(function (features, feature) {
              if(feature.type=="Feature"){
                features.push(feature);
              }else if(feature.type=="FeatureCollection"){
                features=features.concat(feature.features);
              }else{
                console.log("Unknown type"+feature.type);
              }
              return features
          }, []);
          uploadData(id,options,tags,{type:"FeatureCollection",features:totalFeatures},true,options.ptag,options.file,options.id);
        },100);
      }else if(options.file.indexOf(".shp")!=-1){
        transform.readShapeFile(options.file,function(result){
          uploadData(id,options,tags,result,true,options.ptag,options.file,options.id);
        },true);
      }else if(options.file.indexOf(".csv")!=-1){
        transform.read(options.file,function(result){
          var object = {features:transform.transform(result,options.lat,options.lon,options.alt),type:"FeatureCollection"};
          uploadData(id,options,tags,object,true,options.ptag,options.file,options.id);
        },true);
      }else{
        transform.read(options.file,function(result){
          uploadData(id,options,tags,JSON.parse(result),true,options.ptag,options.file,options.id);
        },false);
      }     
  } else {
      const getStdin = require('get-stdin');
      getStdin().then(str => {
	try{
           obj = JSON.parse(str);
           uploadData(id,options,tags,obj,false,options.ptag,null,options.id);
	}catch(e){
	   console.log("Empty or invalid input to upload. Refer to 'here xyz upload -h' for help");
        
	}
      });
  }
});

function createQuestionsList(object){
    for(i=0; i < 3 && i < object.features.length; i++){
      var j = 0;
      for(key in object.features[0].properties){
        if (i === 0){
          var desc = "" + (1 + (j++)) + " : " + key + " : " + object.features[i].properties[key];
          choiceList.push({name:desc,value:key});
        } else {
          choiceList[j].name = choiceList[j].name + " , " + object.features[i].properties[key];
          j++;
        }
      }
    }
    return questions;
}

function uploadData(id,options,tags,object,isFile,tagProperties,fileName,uid){
  if(object.type=="Feature"){
    object = {features:[object],type:"FeatureCollection"};
  }
  if(options.assign){
    //console.log("assign mode on");
    var questions  = createQuestionsList(object);
    inquirer.prompt(
      questions
    ).then(answers => {
      if(options.ptag === undefined){
        options.ptag = '';
      }
      options.ptag = options.ptag + answers.tagChoices;
      if(options.id === undefined){
        options.id = '';
      }
      options.id = options.id + answers.idChoice
      //console.log(options.ptag);
      //console.log("unique key - " + options.id);
      //Need to be inside if, else this will be executed before user choice is inserted as its async
      uploadDataToSpaceWithTags(id,options,tags,object,false,options.ptag,fileName,options.id);
    })
  } else {
    uploadDataToSpaceWithTags(id,options,tags,object,false,options.ptag,fileName,options.id);
  }
}

function uploadDataToSpaceWithTags(id,options,tags,object,isFile,tagProperties,fileName,uid){
  var gsv = require("geojson-validation");
  gsv.valid(object, function(valid, errs){
    if(!valid){
       console.log(errs);
    }else{
      mergeAllTags(object.features,tags,tagProperties,fileName,uid,options,function(featureOut){
        var chunks =(options.chunk)? chunkify(featureOut,parseInt(options.chunk)):[featureOut];
        var chunkSize = chunks.length;
        var index = 0;
        iterateChunks(chunks,"/hub/spaces/" + id + "/features",index,chunkSize,function(){
            if(isFile)
              console.log("'" + options.file + "' uploaded to xyzspace '" + id + "' successfully");
            else
              console.log("data upload to xyzspace '" + id + "' completed successfully");

              summary.summarize(featureOut,id,true);
        });
      });
      
    }
  });
}

function extractOption(callBack){
  inquirer.prompt([{
    name: 'choice',
    type: 'list',
    message: 'xyz upload will generate unique IDs for all features by default (no features will be overwritten). See upload -h for more options.',
    choices: ['continue', 'quit'],
    default: 0,
  }]).then((answers) => {
    if(answers.choice=="continue"){
      callBack();
    }else{
      process.exit();
    }
  });
}

function mergeAllTags(features,tags,tagProperties,fileName,idStr,options,callBack){ 
  var inputTags = [];
  tags.split(",").forEach(function (item) {
    if(item && item!="")
      inputTags.push(item.toLowerCase());
  });
  var tps =tagProperties?tagProperties.split(","):null;
  var checkId=false;
  var featureMap = [];
  var duplicates = new Array();
  features.forEach(function (item) {
    var finalTags = inputTags.slice();
    var origId=null;
    //Generate id only if doesnt exist
    if(!item.id && idStr){
      var fId = createUniqueId(idStr,item);
      if(fId && fId!=""){
        item.id = fId;
      }
    }else{
       if(options.unique){
          checkId=true;
          origId=item.id;
          item.id = undefined;
          var id=common.md5Sum(JSON.stringify(item));
          item.id = id;
          if(featureMap[item.id]){
            var dupe = {id:origId,geometry:JSON.stringify(item.geometry),properties:JSON.stringify(item.properties)};
            duplicates.push(dupe);
          }
       }
    }
    if(options.unique){
      if(!featureMap[item.id]){
        featureMap[item.id] = item;
      }
    }
    if(!item.properties){
      item.properties={};
    }
    var metaProps = item.properties["@ns:com:here:xyz"];
    if(!metaProps){
      metaProps={};
    }
    if(metaProps && metaProps.tags){
      finalTags = finalTags.concat(metaProps.tags);
    }
    if(tps){
        tps.forEach(function (tp) {
          if(item.properties[tp]){
            if(Array.isArray(item.properties[tp])){
              for (i in item.properties[tp]) {
                addTagsToList(item.properties[tp][i], tp, finalTags);
              }
            } else {
              addTagsToList(item.properties[tp], tp, finalTags);
            }            
          }
        });
    }
    var nameTag = fileName?getFileName(fileName):null;
    if(nameTag){
      finalTags.push(nameTag);
    }
    if(origId){
      metaProps.originalFeatureId=origId;
    }
    metaProps.tags=uniqArray(finalTags);
    item.properties["@ns:com:here:xyz"]=metaProps;
  });

  if(options.unique && duplicates.length>0){
    var featuresOut = new Array();
    for(var k in featureMap){
      featuresOut.push(featureMap[k]);
    }
    console.log("***************************************************************");
    console.log("We detected duplicate records, only the first was uploaded.\nFind the below records which are duplicated\n");
    common.drawTable(duplicates,["id","geometry","properties"]);
    console.log("uploaded "+featuresOut.length+ " out of "+features.length+" records");
    console.log("***************************************************************\n");
    callBack(featuresOut);
  }else{
    callBack(features);
  }
}

function addTagsToList(value,tp, finalTags){
  value = value.toString().toLowerCase();
  value= value.replace(/\s+/g, '_');
  finalTags.push(value);
  finalTags.push(tp+"@"+value);
  return finalTags;
}

function createUniqueId(idStr,item){
  var ids = idStr.split(",");
  var vals =new Array();
  ids.forEach(function (id) {
        var v = item.properties?item.properties[id]:null;
        if(v){
          vals.push(v);
        }
  });
  var idFinal=vals.join("-");
  return idFinal;
}

function uniqArray(a) {
  return Array.from(new Set(a));
}

function getFileName(fileName){
  try{
    var path = require("path");
    var bName =  path.basename(fileName);
    if(bName.indexOf(".")!=-1){
      bName = bName.substring(0,bName.lastIndexOf('.'));
    }
    return bName;
  }catch(e){
    return null;
  }
}

function iterateChunks(chunks,url,index,chunkSize,callBack){
  var item = chunks.shift();
  var fc = { "type":"FeatureCollection","features":item};
  execute(url, "PUT", "application/geo+json", JSON.stringify(fc), function (body) {
      index++;
      if(index==chunkSize){
	        callBack();
      }else{
            console.log("uploaded "+((index/chunkSize)*100).toFixed(2)+"%");
            iterateChunks(chunks,url,index,chunkSize,callBack);
      }
  },null,true);
}

function chunkify(data,chunksize){
	var chunks = [];
        for(var k in data){
          var item=data[k];
	  if(!chunks.length || chunks[chunks.length-1].length == chunksize)
		chunks.push([]);
	  chunks[chunks.length-1].push(item);
	}
	return chunks;
}

function executeWithPromise(uri, method, contentType, data, onSuccess, onFailure,gzip,extToken) {
  return new Promise(function(resolve, reject) {
    common.verify(function (request, token) {
      var finalToken  = (extToken) ? extToken: token;
      execInternal(uri, method, contentType, data, finalToken, function (body) {
        resolve(body)
      }, function (errorObj) {
        if (onFailure) {
          reject(new Error(errorObj));
        } else {
          console.log("Command Failure :" + errorObj.body)
        }
      },gzip);
    }, function () {});
  });
}

function launchHereGeoJson(uri){
  common.verify(function (request, token) {
    var accessAppend=(uri.indexOf("?")==-1)?'?access_token='+token:'&access_token='+token
    var opn = require("open");
    opn('http://geojson.tools/index.html?url='+common.xyzRoot()+uri+accessAppend);
  }, function () {
  });
}
common.validate(["list","show","create","delete","upload","describe","clear","token","analyze"],[process.argv[2]],program);
program.parse(process.argv);
