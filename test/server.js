/*
  Copyright (C) 2018 - 2021 HERE Europe B.V.
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

const express = require('express')
const app = express()
const port = 3578;

app.get('/', (req, res) => res.send('Hello World!'));

app.post("/token-api/tokens", function(req, res) {
    res.send({});
});
app.get("/token-api/tokens", function(req, res) {
    res.send({tokens:[{id:"a",type:"b",iat:"c",description:"d"}]});
});
app.get("/hub/spaces", function(req, res) {
    res.send([{"id":"oQ8SICzO","title":"a new Data Hub space created from commandline","description":"a new Data Hub space created from commandline","owner":"eLmjOcdwpIk6Svi51Lah"}]);
});
app.get("/hub/spaces/:spaceId", function(req, res) {
    res.send({"id":"oQ8SICzO","title":"a new Data Hub space created from commandline","description":"a new Data Hub space created from commandline","owner":"eLmjOcdwpIk6Svi51Lah"});
});
app.get("/hub/spaces/:spaceId/iterate", function(req, res) {
    res.send({"type":"FeatureCollection","etag":"866d7c6581589e37","streamId":"38387417-3102-11e9-baea-7bdf3a786698","features":[{"id":"9376020521","bbox":[0.21306,47.97855,0.21336,47.97901],"type":"Feature","properties":{"ruleId":"PAD030","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@pad030","isocode@fra","groupkey@fra;quarterly;pad","program@pad","cadence@quarterly"],"space":"GZtULMpb","createdAt":1550048437484,"updatedAt":1550048437484},"@ns:com:here:rmob":{"fc":3,"linkId":"1814549030","adminId":"241715910","isUrban":true,"groupKey":"FRA;QUARTERLY;PAD","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"FRA"}},"geometry":{"type":"MultiLineString","coordinates":[[[0.21336,47.97855,0.0],[0.21331,47.97861,0.0],[0.21326,47.97867,0.0],[0.21322,47.97872,0.0],[0.21317,47.97881,0.0],[0.21306,47.97901,0.0]]]}},{"id":"9376028927","bbox":[5.93369,50.75031,5.93369,50.75076],"type":"Feature","properties":{"ruleId":"POI017","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@poi017","isocode@bel","groupkey@bel;daily;poi","program@poi","cadence@daily"],"space":"GZtULMpb","createdAt":1550048437484,"updatedAt":1550048437484},"@ns:com:here:rmob":{"fc":5,"linkId":"8060153021","adminId":"139531018","isUrban":true,"groupKey":"BEL;DAILY;POI","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"BEL"}},"geometry":{"type":"MultiLineString","coordinates":[[[5.93369,50.75031,0.0],[5.93369,50.75076,0.0]]]}},{"id":"9376048656","bbox":[11.56092,48.13991,11.56099,48.14032],"type":"Feature","properties":{"ruleId":"POI251","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@poi251","isocode@deu","groupkey@deu;weekly;poi","program@poi","cadence@weekly"],"space":"GZtULMpb","createdAt":1550048437509,"updatedAt":1550048437509},"@ns:com:here:rmob":{"fc":3,"linkId":"155987012","adminId":"150749781","isUrban":true,"groupKey":"DEU;WEEKLY;POI","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"DEU"}},"geometry":{"type":"MultiLineString","coordinates":[[[11.56092,48.13991,0.0],[11.56094,48.13999,0.0],[11.56099,48.14032,0.0]]]}},{"id":"9375798871","bbox":[-6.02509,54.55626,-6.02461,54.55636],"type":"Feature","properties":{"ruleId":"ADD029","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@add029","isocode@gbr","groupkey@gbr;quarterly;add","program@add","cadence@quarterly"],"space":"GZtULMpb","createdAt":1550048437509,"updatedAt":1550048437509},"@ns:com:here:rmob":{"fc":5,"linkId":"458203148","adminId":"457765392","isUrban":true,"groupKey":"GBR;QUARTERLY;ADD","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"GBR"}},"geometry":{"type":"MultiLineString","coordinates":[[[-6.02461,54.55626,0.0],[-6.0248,54.55633,0.0],[-6.02492,54.55636,0.0],[-6.02499,54.55635,0.0],[-6.02509,54.55627,0.0]],[[-6.02461,54.55626,0.0],[-6.0248,54.55633,0.0],[-6.02492,54.55636,0.0],[-6.02499,54.55635,0.0],[-6.02509,54.55627,0.0]],[[-6.02461,54.55626,0.0],[-6.0248,54.55633,0.0],[-6.02492,54.55636,0.0],[-6.02499,54.55635,0.0],[-6.02509,54.55627,0.0]],[[-6.02461,54.55626,0.0],[-6.0248,54.55633,0.0],[-6.02492,54.55636,0.0],[-6.02499,54.55635,0.0],[-6.02509,54.55627,0.0]]]}},{"id":"9375841173","bbox":[-6.00722,54.54558,-6.00697,54.5458],"type":"Feature","properties":{"ruleId":"ADD029","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@add029","isocode@gbr","groupkey@gbr;quarterly;add","program@add","cadence@quarterly"],"space":"GZtULMpb","createdAt":1550048437509,"updatedAt":1550048437509},"@ns:com:here:rmob":{"fc":5,"linkId":"1053922551","adminId":"457765392","isUrban":true,"groupKey":"GBR;QUARTERLY;ADD","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"GBR"}},"geometry":{"type":"MultiLineString","coordinates":[[[-6.00722,54.54558,0.0],[-6.00712,54.54567,0.0],[-6.00697,54.5458,0.0]],[[-6.00722,54.54558,0.0],[-6.00712,54.54567,0.0],[-6.00697,54.5458,0.0]],[[-6.00722,54.54558,0.0],[-6.00712,54.54567,0.0],[-6.00697,54.5458,0.0]],[[-6.00722,54.54558,0.0],[-6.00712,54.54567,0.0],[-6.00697,54.5458,0.0]]]}}]});
});
app.get("/hub/spaces/:spaceId/search", function(req, res) {
    res.send({"type":"FeatureCollection","etag":"866d7c6581589e37","streamId":"38387417-3102-11e9-baea-7bdf3a786698","features":[{"id":"9376020521","bbox":[0.21306,47.97855,0.21336,47.97901],"type":"Feature","properties":{"ruleId":"PAD030","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@pad030","isocode@fra","groupkey@fra;quarterly;pad","program@pad","cadence@quarterly"],"space":"GZtULMpb","createdAt":1550048437484,"updatedAt":1550048437484},"@ns:com:here:rmob":{"fc":3,"linkId":"1814549030","adminId":"241715910","isUrban":true,"groupKey":"FRA;QUARTERLY;PAD","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"FRA"}},"geometry":{"type":"MultiLineString","coordinates":[[[0.21336,47.97855,0.0],[0.21331,47.97861,0.0],[0.21326,47.97867,0.0],[0.21322,47.97872,0.0],[0.21317,47.97881,0.0],[0.21306,47.97901,0.0]]]}},{"id":"9376028927","bbox":[5.93369,50.75031,5.93369,50.75076],"type":"Feature","properties":{"ruleId":"POI017","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@poi017","isocode@bel","groupkey@bel;daily;poi","program@poi","cadence@daily"],"space":"GZtULMpb","createdAt":1550048437484,"updatedAt":1550048437484},"@ns:com:here:rmob":{"fc":5,"linkId":"8060153021","adminId":"139531018","isUrban":true,"groupKey":"BEL;DAILY;POI","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"BEL"}},"geometry":{"type":"MultiLineString","coordinates":[[[5.93369,50.75031,0.0],[5.93369,50.75076,0.0]]]}},{"id":"9376048656","bbox":[11.56092,48.13991,11.56099,48.14032],"type":"Feature","properties":{"ruleId":"POI251","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@poi251","isocode@deu","groupkey@deu;weekly;poi","program@poi","cadence@weekly"],"space":"GZtULMpb","createdAt":1550048437509,"updatedAt":1550048437509},"@ns:com:here:rmob":{"fc":3,"linkId":"155987012","adminId":"150749781","isUrban":true,"groupKey":"DEU;WEEKLY;POI","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"DEU"}},"geometry":{"type":"MultiLineString","coordinates":[[[11.56092,48.13991,0.0],[11.56094,48.13999,0.0],[11.56099,48.14032,0.0]]]}},{"id":"9375798871","bbox":[-6.02509,54.55626,-6.02461,54.55636],"type":"Feature","properties":{"ruleId":"ADD029","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@add029","isocode@gbr","groupkey@gbr;quarterly;add","program@add","cadence@quarterly"],"space":"GZtULMpb","createdAt":1550048437509,"updatedAt":1550048437509},"@ns:com:here:rmob":{"fc":5,"linkId":"458203148","adminId":"457765392","isUrban":true,"groupKey":"GBR;QUARTERLY;ADD","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"GBR"}},"geometry":{"type":"MultiLineString","coordinates":[[[-6.02461,54.55626,0.0],[-6.0248,54.55633,0.0],[-6.02492,54.55636,0.0],[-6.02499,54.55635,0.0],[-6.02509,54.55627,0.0]],[[-6.02461,54.55626,0.0],[-6.0248,54.55633,0.0],[-6.02492,54.55636,0.0],[-6.02499,54.55635,0.0],[-6.02509,54.55627,0.0]],[[-6.02461,54.55626,0.0],[-6.0248,54.55633,0.0],[-6.02492,54.55636,0.0],[-6.02499,54.55635,0.0],[-6.02509,54.55627,0.0]],[[-6.02461,54.55626,0.0],[-6.0248,54.55633,0.0],[-6.02492,54.55636,0.0],[-6.02499,54.55635,0.0],[-6.02509,54.55627,0.0]]]}},{"id":"9375841173","bbox":[-6.00722,54.54558,-6.00697,54.5458],"type":"Feature","properties":{"ruleId":"ADD029","references":[],"featureType":"Violation","@ns:com:here:xyz":{"tags":["workspace@weu_bw_1901","active@yes","status@pending","rulecode@add029","isocode@gbr","groupkey@gbr;quarterly;add","program@add","cadence@quarterly"],"space":"GZtULMpb","createdAt":1550048437509,"updatedAt":1550048437509},"@ns:com:here:rmob":{"fc":5,"linkId":"1053922551","adminId":"457765392","isUrban":true,"groupKey":"GBR;QUARTERLY;ADD","leStatus":"Exception","workspace":"WEU_BW_1901"},"@ns:com:here:uom:meta":{"uomVersion":"uom-schema-1.4.1","isoCountryCode":"GBR"}},"geometry":{"type":"MultiLineString","coordinates":[[[-6.00722,54.54558,0.0],[-6.00712,54.54567,0.0],[-6.00697,54.5458,0.0]],[[-6.00722,54.54558,0.0],[-6.00712,54.54567,0.0],[-6.00697,54.5458,0.0]],[[-6.00722,54.54558,0.0],[-6.00712,54.54567,0.0],[-6.00697,54.5458,0.0]],[[-6.00722,54.54558,0.0],[-6.00712,54.54567,0.0],[-6.00697,54.5458,0.0]]]}}]});
});

app.delete("/hub/spaces/:spaceId", function(req, res) {
    res.send({});
});
app.patch("/hub/spaces/:spaceId", function(req, res) {
    res.send({"id":"testing"});
});
app.post("/hub/spaces/", function(req, res) {
    res.send({"id":"testing"});
});
app.put("/hub/spaces/:spaceId/features", function(req, res) {
    res.send({});
});
app.post("/hub/spaces/:spaceId/features", function(req, res) {
    res.send({});
});
app.delete("/hub/spaces/:spaceId/features", function(req, res) {
    res.send({});
});

var server=null;
exports.listen = function () {
    server = app.listen(port,()=>"Started Listening");
    //console.log("Server Started on "+port);
}

exports.close = function (callback) {
    server.close();
};

//server = app.listen(port,()=>"Started Listening");
