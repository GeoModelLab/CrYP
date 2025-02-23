// CrYP - NDVI export
//
// Generates an ImageCollection of vegetation data and export it as asset.
// This is meant to overcome memory errors than can occur when using large time-series.
//
// !!! Remember to create an empty image collection in your assets. 
// Once created, replace the link at line 79 with your own image collection id.
// line 79: ---> var imgCol_id = 'projects/ee-lcrecco94/assets/CrYP_imgCol'; (change with your asset)


var run = function(){
  
      var AOI = CrYP_ui.AOI;
      print(AOI);
      
      // get Crop Variables (dict) and type
      var sensor_type = CrYP_ui.general.sensor; // MODIS
      
      // get REF_date  
      var num_months    = CrYP_ui.general.extent; 
      
      var ref_date   = ee.Date.fromYMD(CrYP_ui.general.year, CrYP_ui.general.month, 1);  // for modis collection and outputs.
      var stop_date  = ref_date.advance(num_months, "month");
      
      // require functions
      var tools            = require('users/lcrecco94/app:tools_lib');
      var veg_functions    = require('users/lcrecco94/app:vegetation_lib');

      
      // *********************************************************
      // 1. get NDVI 
      print(CrYP_ui);
      
      switch (sensor_type) {
        
        case 'MODIS':
          print('preparing MODIS ImageCollection');

          var NDVI = veg_functions.get_vegetation(ref_date, stop_date, AOI);
          print(NDVI);

          // Smooth the NDVI time series by the Savitzky–Golay filter
          var sg_filter = require('users/Yang_Chen/GF-SG:SG_filter_v1');
          var list_trend_sgCoeff = ee.List([-0.070588261,-0.011764720,0.038009040,0.078733027,0.11040724,0.13303168,0.14660634, 0.15113123,0.14660634,0.13303168,0.11040724,0.078733027,0.038009040,-0.011764720,-0.070588261]);   //suggested trend parameter:(7,7,0,2)
          var list_sg_coeff      = ee.List([0.034965038,-0.12820521,0.069930017,0.31468537,0.41724950,0.31468537, 0.069930017,-0.12820521,0.034965038]);   //suggested parameters of SG:(4,4,0,5)
            
          var mod_ndvi_sg = sg_filter.sg_filter_chen(NDVI, list_trend_sgCoeff, list_sg_coeff);
          var ndvi_sg = mod_ndvi_sg.map(function(img){
                                              return img.rename('ndvi').copyProperties(img, ['system:time_start']);
                                            });
          
          // Daily interpolation
          var frame  = 1; 
          var NDVI_int = tools.linearInterpolation(ndvi_sg, frame).map(function (img) {
                var img_noprop = img.multiply(1);
                return img_noprop.rename('ndvi').set('system:time_start', img.get("system:time_start"));
              });
          print(NDVI_int);
          Map.addLayer(NDVI_int);


          break;
        
        case 'Sentinel2':
          print('preparing Sentinel2 ImageCollection');
          print('Not Yet Developed---');
          
          
          break;
      }
      
      // *********************************************************
      // 2. Exporting ImageCollection to Assets
      
      // First create a new empty collection
      // Go to Assets Tab -> New -> Image collection
      
      // Once created, replace below with your own image collection id
      var imgCol_id = 'projects/ee-lcrecco94/assets/CrYP_imgCol';

      var doExportAsset = function() {
        print('Working');
        var ids = NDVI_int.aggregate_array('system:index');
        // evaluate() will not block the UI and once the result is available
        // will be passed-on to the callback function where we will call
        // Export.image.toAsset()
        ids.evaluate(function(imageIds) {
          print('Total number of images', imageIds.length);
          print('Exporting now... (see Tasks tab)');
          print('Tip: Use Ctrl+Click/Cmd+Click on tasks to skip confirmation.');
          for(var i = 0; i < imageIds.length; i++) {
            
            // Filter using the image id
            var image = ee.Image(NDVI_int.toList(1, i).get(0));
      
            Export.image.toAsset({
              image: image,
              description: 'Export_Asset_' + CrYP_ui.general.year + '_' + imageIds[i],
              assetId: imgCol_id + '/' + CrYP_ui.general.year + '_' + imageIds[i],
              region: CrYP_ui.AOI.geometry(),
              scale: 250
            });
          }
        });
        
      };
      
      doExportAsset();        
};


// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
var CrYP_ui = {
  general : {
    sensor : null,  // MODIS only for now
    year    : null, // start year
    month   : null, // start month
    extent  : null  
  },

  AOI : null,      // it will be a geometry
};

CrYP_ui.OnSEChange=function(isChecked){
    //print(this);
    if (isChecked===true) {
      //print('yes')
      CrYP_ui.spatialExtGeoSel.setDisabled(true);
      CrYP_ui.spatialExtAssetsSel.setDisabled(false);
    } else {
      CrYP_ui.spatialExtGeoSel.setDisabled(false);
      CrYP_ui.spatialExtAssetsSel.setDisabled(true);
    }};
    
CrYP_ui.Start = function (){    
  var labelStyle= {width:'120px',fontSize:'14px', fontWeight:'bold'};
  var labelStyle2= {width:'300px',fontSize:'14px', fontWeight:'bold'};
  var panelStyle= {border:'1px solid blue',width: '650px',margin:'3px'};
  var controlPanel   = ui.Panel({style: {width: '680px',height:'1000px'}});
  
  controlPanel.add(ui.Label('CrYP - NDVI export',
                  {fontWeight:'bold', margin:'3px', fontSize:'18px'}));
  
  controlPanel.add(ui.Label('This script is meant to overcome GEE memory issues when working with large time series.',
                  {fontWeight:'regular',margin:'3px',
                  fontSize:'14px'}));
                  
  controlPanel.add(ui.Label('It allows exporting a vegetation time-series that can be used in CrYP app.',
                  {fontWeight:'regular',margin:'3px',
                  fontSize:'14px'}));
  
  // Section A: Sensor Type
  
  var sensor_list = ['MODIS', 'Sentinel2'];
  CrYP_ui.sensorTypeSelector = ui.Select({
        items: sensor_list,
        placeholder: 'Select Sensor Type',
        onChange: function (value) {
          
          // update sensor value
          CrYP_ui.general.sensor = value;
          
          if (value === 'MODIS'){
              var dates = ee.List(ee.ImageCollection("MODIS/006/MOD13Q1").get('date_range')).getInfo();
              var start = ee.Date(dates[0]).get('year');
              var end   = ee.Date(dates[1]).get('year');
              
              var yList     = ee.List.sequence(start, end).map(function(y){
                                        return ee.String(y).slice(0,4);
                                      }).getInfo();
                                      
          } else if (value === 'Sentinel2') {
              var dates = ee.List(ee.ImageCollection("COPERNICUS/S2_HARMONIZED").get('date_range')).getInfo();
              var start = ee.Date(dates[0]).get('year');
              var end   = ee.Date(dates[1]).get('year');
              
              var yList     = ee.List.sequence(start, end).map(function(y){
                                        return ee.String(y).slice(0,4);
                                      }).getInfo();
          } 
          
          // update yearSelector panel's options
          CrYP_ui.cropYearSelector.items().reset(yList);
        },
        style : {stretch: 'horizontal'}});
        
  var sensortypePanel = ui.Panel({style: {width: '320px'}})    
                       .add(ui.Panel([ui.Label("Sensor Type:", labelStyle), CrYP_ui.sensorTypeSelector], ui.Panel.Layout.flow('horizontal')));
                            
                        
  controlPanel.add(ui.Panel([sensortypePanel], ui.Panel.Layout.flow('horizontal'), panelStyle));

  // Section B: Temporal extent
  var yList;
  CrYP_ui.cropYearSelector = ui.Select({
        items: yList,
        placeholder: 'select year',
        onChange: function (value) {
          CrYP_ui.general.year = Number(value);}
          });
        
  var month_list = ee.List([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).map(function(y){
                            return ee.String(y).slice(0,4);
                          }).getInfo();
                          
  CrYP_ui.cropMonthSelector = ui.Select({
        items: month_list,
        placeholder: 'select month',
        onChange: function (value) {
          CrYP_ui.general.month = Number(value);}
    
  });
        
 CrYP_ui.cropExtentSelector = ui.Slider({value:0,min:0,max:12,step:1, 
        onChange: function(value){CrYP_ui.general.extent = Number(value);},
        style:{stretch: 'horizontal'}
        });
        
  var yearPanel = ui.Panel({style: {width: '230px'}})    
                       .add(ui.Panel([ui.Label("Time Range:", labelStyle), CrYP_ui.cropYearSelector], ui.Panel.Layout.flow('horizontal')));
                            
  var monthPanel = ui.Panel({style: {width: '110px'}})    
                        .add(ui.Panel([CrYP_ui.cropMonthSelector], ui.Panel.Layout.flow('horizontal')));
  
  var extentPanel = ui.Panel({style: {width: '300px'}})    
                        .add(ui.Panel([ui.Label("growing season length (months):", {width: '120px', fontSize:'12px'}), CrYP_ui.cropExtentSelector], ui.Panel.Layout.flow('horizontal')));
                        
  controlPanel.add(ui.Panel([yearPanel, monthPanel, extentPanel], ui.Panel.Layout.flow('horizontal'), panelStyle));
 

  // Section C: AOI
  
  var activeNameList = Map.drawingTools().layers().map(function(lyr){
                        return lyr.getName();
                         });
 
  CrYP_ui.spatialExtGeoSel = ui.Select({items:activeNameList,
                       placeholder:"Active geometry",
                       onChange:function(value){  
                         var ind=activeNameList.indexOf(value);
                         CrYP_ui.AOI=ee.FeatureCollection(Map.drawingTools().layers().get(ind).toGeometry());
                         Map.centerObject(CrYP_ui.AOI);
                       },
                       style:{width:'120px'}});
    
    //extract avaliable feature (table) from assets
      var rootAssetsFolder = ee.data.listBuckets("projects/earthengine-legacy").assets;//ee.data.getAssetRoots();

      var ft_ids=[]; 
      var disable=true;
      if (Object.keys(rootAssetsFolder).length !== 0)  {
        var assetslist= ee.data.listAssets(rootAssetsFolder[0].id);
        if (assetslist.assets !== null){// ensure none empty assets
        disable=false; 
        //var assetslist= ee.data.listAssets(rootAssetsFolder[0].id);
        ft_ids=assetslist.assets
                  .filter(function(obj){return obj.type=='TABLE';})
                  .map(function(obj){return obj.id;});
      } }
      
      
    CrYP_ui.spatialExtAssetsSel = ui.Select({items:ft_ids,
                       placeholder:"Assets",
                       onChange:function(value){
                         CrYP_ui.AOI=ee.FeatureCollection(value);
                         Map.addLayer(CrYP_ui.AOI);
                         Map.centerObject(CrYP_ui.AOI);
                       },
                       disabled:true,
                       style:{width:'120px'}});
    
    
    controlPanel.add(ui.Panel([ui.Label("Study area:",labelStyle),
                              ui.Checkbox("From Assets",false,CrYP_ui.OnSEChange,disable),
                              CrYP_ui.spatialExtGeoSel,CrYP_ui.spatialExtAssetsSel],
                              ui.Panel.Layout.flow('horizontal'),panelStyle)); 
    
    var runButton = ui.Button('Run');
    runButton.onClick(run);     

    controlPanel.add(runButton);

ui.root.add(controlPanel);
};

CrYP_ui.Start();
