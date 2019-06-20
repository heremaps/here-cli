#### Transform csv to geojson 

- ##### Convert the provided csv file as geojson
```
here transform csv2geo /Users/dhatb/mapcli_publish/mapcli/bin/test.csv
```
###### system will try to autodetect the latitude and longitude fieldname from the following matched field names.
- longitude ->  "x", "xcoord", "xcoordinate", "coordx", "coordinatex", "longitude", "lon"
- latitudde -> "y", "ycoord", "ycoordinate", "coordy", "coordinatey", "latitude", "lat"

##### Options
-y, --lat [lat]  latitude field name
-x, --lon [lon]  longitude field name
-d, --delimiter [,]  delimiter for parsing csv
-q, --quote ["]  quote used for parsing csv
-po, --point [point]  points field name

#### Transform shapefile to geojson 
- ##### Convert the provided shape file as geojson
```
here transform shp2geo /Users/dhatb/mapcli_publish/mapcli/bin/test.shp
```
