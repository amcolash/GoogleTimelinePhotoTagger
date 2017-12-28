#!/usr/bin/env node

var lerp = require('lerp');
var moment = require('moment');
var tj = require('@mapbox/togeojson');
var fs = require('fs');
var DOMParser = require('xmldom').DOMParser;

var args = [];

for (var i = 0; i < process.argv.length; i++) {
  var arg = process.argv[i];
  if (!arg.includes("/node")) {
    args.push(arg);
  }
}

if (args.length < 2) {
  console.error("usage: timeline.js [locations.json] [(Optional) timezone offset]");
  process.exit(1);
}

var kml = new DOMParser().parseFromString(fs.readFileSync(args[1], 'utf8'));
var converted = tj.kml(kml);

if (args.length > 2) {
  var offset = args[2];
  console.log(offset)
}

var searchDate;
searchDate = moment('2017-12-26T17:30:19-06:00'); // comment out to disable searching
searchDate = moment('2017-12-26T17:33:37-06:00');

for (var i = 0; i < converted.features.length; i++) {
  var feature = converted.features[i];
  var start = moment(feature.properties.timespan.begin);
  var end = moment(feature.properties.timespan.end);
  
  
  if (!searchDate || searchDate.isBetween(start, end) || searchDate.isSame(start) || searchDate.isSame(end)) {
    if (!searchDate) {
      console.log("--------------------------------");
      console.log(feature.properties.name);
      console.log(start.toString());
      console.log(end.toString());
    }

    for (var j = 0; j < feature.geometry.geometries.length; j++) {
      var geo = feature.geometry.geometries[j];
      if (geo.type === "LineString") {
        var totalDuration = end.diff(start);
        var partialDuration = searchDate.diff(start);
        var percent = partialDuration / totalDuration;

        if (geo.coordinates.length === 1) {
          // Simple case
          var lat = geo.coordinates[0][0];
          var lng = geo.coordinates[0][1];
        } else {
          // If we have more than one point, we are assuming that we are moving at a constant velocity

          // Find which coordinates to lerp between
          var index = percent * (geo.coordinates.length - 1);
          var fraction = index - Math.floor(index);
          index = Math.floor(index); // floor index now

          // Lerp between closest points
          var lat = lerp(geo.coordinates[index][0], geo.coordinates[index + 1][0], fraction);
          var lng = lerp(geo.coordinates[index][1], geo.coordinates[index + 1][1], fraction);
        }

        console.log(lat + ", " + lng);
      }
    }
  }
}