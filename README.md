# GoogleTimelinePhotoTagger
Parse google timeline kml files and tag photo geolocations from the info

## Dependencies
This script requires [nodejs](https://nodejs.org/) and [exiftool](https://www.sno.phy.queensu.ca/~phil/exiftool/) to be installed. Once they are installed, you should be all set to get tagging!

## Running the Script
Clone this repo: `git clone https://github.com/amcolash/GoogleTimelinePhotoTagger.git`
Change directories: `cd GoogleTimelinePhotoTagger`
Install the dependencies: `npm install`
Run it: `node timeline.js [kml file] [photo directory]`

## Getting KML from google timeline
Head to [google timeline](https://www.google.com/maps/timeline) to get your data. For each day you want, click the gear in the bottom right corner and select "Export this day to KML"

## Merging multiple days of KML together
Check out [kmlmerger](https://kmlmerger.com/) to merge together a few days of data when batching a photos from trip.