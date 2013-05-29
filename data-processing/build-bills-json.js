/**
 * Gets the bill list, adds in Open States data and 
 * produces a JSON file.
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var moment = require('moment');
var q = require('q');
var RestClient = require('node-rest-client').Client;
var restClient = new RestClient();

// Top level variables
var sourceFile = path.join(__dirname, '../data/bills-list.json');
var outputFile = path.join(__dirname, '../data/bills.json');
// Please don't steal
var OSAPIKey = '1e1c9b31bf15440aacafe4125f221bf2';
var billLookupURL = 'http://openstates.org/api/v1/bills/MN/2013-2014/[[[BILL_ID]]]/?apikey=' + OSAPIKey;
var legislatorLookupURL = 'http://openstates.org/api/v1/legislators/[[[LEG_ID]]]/?apikey=' + OSAPIKey;

// Map categories
var subjectMap = {
  'Agriculture and Food': 'Agriculture and Food',
  'Animal Rights and Wildlife Issues': 'Environment and Recreation',
  'Arts and Humanities': 'Arts and Humanities',
  'Budget, Spending, and Taxes': 'Budget, Spending and Taxes',
  'Business and Consumers': 'Business and Economy',
  'Campaign Finance and Election Issues': 'Campaign Finance and Election Issues',
  'Civil Liberties and Civil Rights': 'Social Issues',
  'Commerce': 'Business and Economy',
  'Crime': 'Crime and Drugs',
  'Drugs': 'Crime and Drugs',
  'Education': 'Education',
  'Energy': 'Energy and Technology',
  'Environmental': 'Environment and Recreation',
  'Executive Branch': 'Government',
  'Family and Children Issues': 'Social Issues',
  'Federal, State, and Local Relations': 'Government',
  'Gambling and Gaming': 'Gambling and Gaming',
  'Government Reform': 'Government',
  'Guns': 'Guns',
  'Health': 'Health and Science',
  'Housing and Property': 'Housing and Property',
  'Immigration': 'Immigration',
  'Indigenous Peoples': 'Social Issues',
  'Insurance': 'Insurance',
  'Judiciary': 'Legal',
  'Labor and Employment': 'Business and Economy',
  'Legal Issues': 'Legal',
  'Legislative Affairs': 'Government',
  'Military': 'Military',
  'Municipal and County Issues': 'Government',
  'Nominations': '',
  'Other': '',
  'Public Services': 'Government',
  'Recreation': 'Environment and Recreation',
  'Reproductive Issues': 'Reproductive Issues',
  'Resolutions': '',
  'Science and Medical Research': 'Health and Science',
  'Senior Issues': 'Social Issues',
  'Sexual Orientation and Gender Issues': 'Social Issues',
  'Social Issues': 'Social Issues',
  'State Agencies': '',
  'Technology and Communication': 'Energy and Technology',
  'Trade': 'Business and Economy',
  'Transportation': 'Transportation',
  'Welfare and Poverty': 'Welfare and Poverty' 
};

// Get data
var sourceData = require(sourceFile);

// Make defer
function makeDeferHTTPRequest(url) {
  var d = q.defer();
  
  restClient.get(url, function(data, response) {
    if (response.statusCode != 200) {
      console.log('Error on OS call: ' + response.statusCode + ' : ' + url);
      return;
    }
    d.resolve(JSON.parse(data), response);
  });
  
  return d.promise;
}

// Parse source bill
function parseSourceBill(bill) {
  var newBill = {};
  
  if (bill.house_vote) {
    newBill.house_ayes = parseInt(bill.house_vote.split('-')[0], 10);
    newBill.house_nays = parseInt(bill.house_vote.split('-')[1], 10);
  }
  else {
    console.log('No house vote on: ' + bill.bill);
  }
  
  if (bill.senate_vote) {
    newBill.senate_ayes = parseInt(bill.senate_vote.split('-')[0], 10);
    newBill.senate_nays = parseInt(bill.senate_vote.split('-')[1], 10);
  }
  else {
    console.log('No senate vote on: ' + bill.bill);
  }
  
  newBill.bill_id = bill.bill;
  newBill.description = bill.description;
  newBill.vetoed = (bill.vetoed && bill.vetoed !== '0') ? true : false;
  newBill.veto_link = bill.veto_link;
  newBill.signed = bill.signed;
  
  return newBill;
}

// Handle finish
function finishProcess(output) {
  // Silly, but given the defers, we just write out the
  // file every time.
  fs.writeFile(outputFile, JSON.stringify(output), function(error) {
    if (error) {
      console.log('Error saving output file: ' + error);
    }
    else {
      console.log('Output saved with rows: ' + Object.keys(output).length);
    }
  });
}

// Process data
(function processData(sourceData) {
  var billsOutput = {};
  var knownLegislators = {};

  sourceData.forEach(function(bill, i) {
    var bill_id = bill.bill;
    var url = billLookupURL.replace('[[[BILL_ID]]]', encodeURIComponent(bill_id));
    
    makeDeferHTTPRequest(url).done(function(data, response) {
      var defers = [];
      
      try {
        billsOutput[bill_id] = parseSourceBill(bill);
        
        // Basics
        billsOutput[bill_id].title = data.title;
        billsOutput[bill_id].billurl = data.sources[0].url;
        billsOutput[bill_id].end_date = data.action_dates.last;
        
        // Start and end date
        data.actions.forEach(function(a) {
          if (a.type[0] == 'bill:introduced') {
            billsOutput[bill_id].start_date = a.date;
          }
          if (a.type[0] == 'governor:vetoed') {
            billsOutput[bill_id].bill_status = 'vetoed';
          }
        });
        
        // Categories
        billsOutput[bill_id].categories = billsOutput[bill_id].categories || [];
        billsOutput[bill_id].categories.push('Transportation');
        data.subjects.forEach(function(s) {
          billsOutput[bill_id].categories = billsOutput[bill_id].categories || [];
          billsOutput[bill_id].categories.push((subjectMap[s]) ? subjectMap[s] : '');
        });
        
        // Status
        billsOutput[bill_id].bill_status = 'indeterminate';
        if (billsOutput[bill_id].signed !== '') {
          billsOutput[bill_id].bill_status = 'signed'; 
        }
        else {
          billsOutput[bill_id].bill_status = 'pending';
        }
        if (data.action_dates.signed) {
          billsOutput[bill_id].bill_status = 'signed';
        }
        if (billsOutput[bill_id].vetoed && billsOutput[bill_id].veto_link === '') {
          billsOutput[bill_id].bill_status = 'vetoed';
          billsOutput[bill_id].categories.push('Vetoed');
        }
        else if (billsOutput[bill_id].vetoed && billsOutput[bill_id].veto_link !== '') {
          billsOutput[bill_id].bill_status = 'partially vetoed';
        }
        
        // Sponsors
        billsOutput[bill_id].senate_sponsors = [];
        billsOutput[bill_id].house_sponsors = [];
        
        data.sponsors.forEach(function(s) {
          if (s.chamber === 'upper' && knownLegislators[s.leg_id]) {
            billsOutput[bill_id].senate_sponsors.push(knownLegislators[s.leg_id]);
          }
          else if (s.chamber === 'lower' && knownLegislators[s.leg_id]) {
            billsOutput[bill_id].house_sponsors.push(knownLegislators[s.leg_id]);
          }
          else {
            defers.push(makeDeferHTTPRequest(legislatorLookupURL.replace('[[[LEG_ID]]]', s.leg_id)));
          }
        });
        
        q.all(defers).done(function(foundLegs) {
          foundLegs.forEach(function(l) {
            var legDetails = [];
            legDetails.push(l.full_name);
            legDetails.push(l.party);
            legDetails.push(l.photo_url);
            legDetails.push(l.url);
            knownLegislators[l.id] = legDetails;
            
            if (l.chamber === 'upper') {
              billsOutput[bill_id].senate_sponsors.push(legDetails);
            }
            else {
              billsOutput[bill_id].house_sponsors.push(legDetails);
            }
          });
        
          // Finish
          finishProcess(billsOutput);
        });
      }
      catch (e) {
        console.log(e);
        console.log('Error on bill data creation for ' + bill_id + ': ' + 
          ' : ' + url);
      }
    });
  });
  
})(sourceData);
