////
//// Determine if the rules in the rules file are true. Complain if not.
//// Usage like:
//// : npm install
//// : node ./check-runner.js -i ./rules.txt
//// : node ./check-runner.js -i ./rules.txt -o ./docs/index.html
//// : node ./check-runner.js -i ./test/rules-tiny.txt -o ./docs/index.html
////

// General.
var us = require('underscore');
var string = require('underscore.string');
var fs = require("fs");
//var yaml = require('yamljs');
var mustache = require('mustache');
var pug = require('pug');

// Setup public AmiGO API environment.
//var node_engine = require('bbop-rest-manager').node;
var node_engine = require('bbop-rest-manager').sync_request;
var amigo = require('amigo2');
var golr_conf = require('golr-conf');
var golr_manager = require('bbop-manager-golr');
var golr_response = require('bbop-response-golr');
//
var gconf = new golr_conf.conf(amigo.data.golr);
var engine = new node_engine(golr_response);
engine.method('POST'); // may make some large requests
var sd = new amigo.data.server();
//_ll(us.keys(sd));
//var golr_url = sd.golr_base();
// Change due to https://github.com/geneontology/shared-annotation-check/issues/6
//var golr_url = 'http://golr-aux.geneontology.io/solr/select';
var golr_url = 'http://golr.geneontology.org/solr/select';
var go = new golr_manager(golr_url, gconf, engine, 'sync');
var linker = new amigo.linker();
// For getting term info later.
var rest_engine = require('bbop-rest-manager').sync_request;
var response_json = require('bbop-rest-response').json;
var resty = new rest_engine(response_json);

///
/// Helpers.
///

// Aliases.
var each = us.each;

function _ll(arg1){
    console.log(arg1);
}

var debug = false;
function _debug(arg1){
    if( debug ){
	console.log(arg1);
    }
}

// Two or one  args.
function _die(m1, m2){
    if( typeof(m2) !== 'undefined' ){
	console.error('ERROR:', m1, m2);
    }else{
	console.error('ERROR:', m1);
    }
    process.exit(-1);
}

function term_info_url(tid){
    return 'http://amigo.geneontology.org/amigo/term/'+tid+'/json';
}

var memo = {};
function get_term_name(tid){
    var ret = tid;

    if( memo[tid] ){
	ret = memo[tid];
    }else{
	try {

	    resty.resource(term_info_url(tid));
	    var r = resty.fetch();
	    if( r && r.okay() ){
		var res = r.raw();
		if( res['results'] && res['results']['name'] && us.isString(res['results']['name']) ){
		    ret = res['results']['name'];
		    memo[tid] = ret;
		}
	    }

	}catch(e){
            ret = tid;
	}
    }

    return ret;
}

///
/// Opts.
///

var argv = require('minimist')(process.argv.slice(2));

// Add extra "debugging" messages.
debug = argv['d'] || argv['debug'];
if( debug ){
    _debug('Debugging is on.');
}else{
}

//
var in_file = argv['i'] || argv['in'];
if( ! in_file ){
    _die('Option (i|in) is required.');
}else{
    _debug('Will use input rule file: ' + in_file);
}

// Template output is optional.
var tmpl_output_p = false;
var out_file = argv['o'] || argv['out'];
if( ! out_file ){
    //_die('Option (o|out) is required.');
}else{
    tmpl_output_p = true;
    _debug('Will use output file: ' + out_file);
}

///
/// Main.
///

_debug('Target: ' + golr_url);
// delete amigo.data.golr;
// delete amigo.data.xrefs;
// delete amigo.data.context;
// delete amigo.data.xrefs;
// delete amigo.data.statistics;
// _debug(JSON.stringify(us.keys(amigo.data), null, 4));
// _debug(JSON.stringify(amigo.data, null, 4));
// _die();

// Read in the rules files.
var raw_file = fs.readFileSync(in_file, 'utf-8');
if( typeof(raw_file) !== 'string' ){
    _die('File could not be opened: ' + in_file);
}else{
    _debug('Read: ' + in_file);
}

// Our rules variables.
// Looks like {idA : {term1: arg1A, term2: arg2A}, intersection_exceptions: [], ...}
var intersection_checks = {};
var error_intersection_accumulator = 0;
var rules_skipped = 0;
var all_annotation_accumulator = 0;
var exp_annotation_accumulator = 0;
var iea_annotation_accumulator = 0;

// Parse the rules file.
var clean_file = string.trim(raw_file);
//_debug('clean_file');
//_debug(clean_file);
var rule_lines = string.lines(clean_file);
//_debug('rule_lines');
//_debug(rule_lines);
each(rule_lines, function(raw_line, index){

    if( raw_line && raw_line !== '' ){

	var line = string.trim(raw_line);
	//_debug('line');
	//_debug(line);
	var columns = line.split(/\t/);
	//_debug('columns');
	//_debug(columns);

	// Switch between NO_OVERLAP and logic modes.
	var term1 = columns[0];
	var term2 = columns[1];
	var intersection_exceptions_raw = columns[2];
	var gp_exceptions_raw = columns[3];

	// Make sure that it is at least grossly a rule.
	if( ! term1 || ! term2 ){ _die('Bad rule: ' + raw_line); }

	// Parse logic.
	var intersection_exceptions = [];
	if( intersection_exceptions_raw ){
	    intersection_exceptions =
		intersection_exceptions_raw.split(/\s*\|\s*/);
	}
	var gp_exceptions = [];
	if( gp_exceptions_raw ){
	    gp_exceptions =
		gp_exceptions_raw.split(/\s*\|\s*/);
	}

	var ln = index + 1;
	intersection_checks[ln] = {
	    'line_number': ln,
	    'raw': raw_line,
	    'term1': term1,
	    'term2': term2,
	    'intersection_exceptions': intersection_exceptions,
	    'gp_exceptions': gp_exceptions
	};
    }
});

//_debug(intersection_checks);
//_die('done');

// Collect all data for export.
var export_data = [];

// Now try the !AND logic tests.
_debug('Running intersection checks...');
each(intersection_checks, function(args, index){

    // Collect data for this intersection.
    var rcache = {};
    rcache['rule-number'] = index; // capture

    // Next, setup the manager environment.
    _debug('Parsed rules, setting up manager...');
    var go = new golr_manager(golr_url, gconf, engine, 'sync');
    go.add_query_filter('document_category', 'bioentity', ['*']);
    go.set_personality('bioentity');
    go.debug(false); // I think the default is still on?
    go.set_results_count(100000); // get up to 100000
    go.current_fl = 'bioentity'; // only want the bioentities back, since we may have a lot

    // Add the first part of the base intersections.
    go.add_query_filter('isa_partof_closure', args['term1']);
    go.add_query_filter('isa_partof_closure', args['term2']);

    // Add all of the items in term exceptions part.
    each(args['intersection_exceptions'], function(exarg){
	go.add_query_filter('isa_partof_closure', exarg, ['-']);
    });

    // Add all of the items in gp exceptions part.
    each(args['gp_exceptions'], function(exarg){
	go.add_query_filter('bioentity', exarg, ['-']);
    });

    // Fetch the data and grab the info we want.
    var resp = go.search();
    var count = resp.total_documents();
    //var bookmark = go.get_state_url();
    var bookmark = 'http://amigo.geneontology.org/amigo/search/bioentity?' +
	    go.get_filter_query_string();

    // Report.
    var export_string = '' +
	    args['term1'] + ' && ' + args['term2'];
    var report_string = 'Check intersection: ' +
	    args['term1'] + ' && ' + args['term2'];
    if( args['intersection_exceptions'].length !== 0 ){
	export_string +=
	    ' && !(' + args['intersection_exceptions'].join(' || ') + ')';
	report_string +=
	    ' && !(' + args['intersection_exceptions'].join(' || ') + ')';
    }
    if( args['gp_exceptions'].length !== 0 ){
	export_string +=
	    ' && !(' + args['gp_exceptions'].join(' || ') + ')';
	report_string +=
	    ' && !(' + args['gp_exceptions'].join(' || ') + ')';
    }
    rcache['bio-summary'] = export_string; // capture
    report_string += ' (' + count + ')';
    _ll(report_string);

    rcache['bio-bookmark'] = bookmark; // capture
    rcache['bio-count'] = count; // capture

    // Human readable names.
    function term_link(t){
	return 'http://amigo.geneontology.org/amigo/term/' + t;
    }
    var exportable_intersection_terms = [
	[ get_term_name(args['term1']), term_link(args['term1']) ],
	[ get_term_name(args['term2']), term_link(args['term2']) ]
    ];
    var exportable_exception_terms = [];
    var readable_str = '................... "' +
	    get_term_name(args['term1']) + '", "' +
	    get_term_name(args['term2']) + '"';
    if( args['intersection_exceptions'].length !== 0 ){
	readable_str += '; with term exceptions: "' +
	    us.map(args['intersection_exceptions'],
		   function(e){
		       exportable_exception_terms.push(
			   [get_term_name(e), term_link(e)]);
		       return get_term_name(e);
		   }).join('", "')+'"';
    }
    if( args['gp_exceptions'].length !== 0 ){
	readable_str += '; with GP exceptions: "' +
	    us.map(args['gp_exceptions'],
		   function(e){
		       exportable_exception_terms.push(
			   [get_term_name(e), term_link(e)]);
		       return e;
		   }).join('", "') + '"';
    }
    _ll(readable_str);
    rcache['rule-terms'] = exportable_intersection_terms; // capture
    rcache['rule-exceptions'] = exportable_exception_terms; // capture

    // List error or not.
    if( count === 0 ){
	rcache['pass-p'] = true; // capture
	_ll('PASS: ' + bookmark);
    }else{

	(function(){

	    error_intersection_accumulator++;
	    _ll('ERROR: found intersection annotations: ' + bookmark);

	    // Okay, collect all of the genes in the intersection, except...
	    var bioentities = [];
	    var docs = resp.documents();
	    each(docs, function(doc){
		// Filter out GP exceptions.
		if( ! us.contains(args['gp_exceptions'], doc['bioentity'])){
		    bioentities.push(doc['bioentity']);
		}
	    });
	    //_ll('BIOENTITIES: ' + bioentities.length);

	    if( bioentities.length > 100 ){
		_ll('Too large for annotation summary: +100');
		rcache['too-large-p'] = true; // capture
		rules_skipped++;
	    }else{

		var local_all_accumulator = 0;
		var local_exp_accumulator = 0;
		var local_iea_accumulator = 0;

		// Withing the intersection tests, look at three
		// different aspects of annotations to help explore
		// what is going on.
		var ann_bookmark = 'tbd';
		each(['total', 'exp', 'iea'], function(test_type){

		    var go = new golr_manager(golr_url, gconf, engine, 'sync');
		    go.add_query_filter('document_category',
					'annotation', ['*']);
		    go.set_personality('annotation');
		    go.debug(false); // I think the default is still on?
		    go.set_results_count(0); // just want counts

		    // Pin current bioentity.
		    var additional = '';
		    if( ! us.isEmpty(args['intersection_exceptions']) ){
			additional = ' -"' +
			    args['intersection_exceptions'].join('" -"') +
			    '"';
		    }

		    var qstr = '(("' +
			    args['term1'] + '" OR "' +
			    args['term2'] + '")' +
			    additional +')';

		    go.add_query_filter('isa_partof_closure', qstr);
		    //_ll('&fq=isa_partof_closure:' + qstr);

		    var bstr = '("' + bioentities.join('" OR "') + '")';
		    go.add_query_filter('bioentity', bstr);
		    //_ll('&fq=bioentity:' + bstr);

		    // Depending on our current type, add different evidence
		    // filters, or none at all.
		    if( test_type === 'total' ){
			// Pass.
		    }else if( test_type === 'exp' ){
			go.add_query_filter('evidence_subset_closure_label',
					    'experimental evidence');
		    }else if( test_type === 'iea' ){
			go.add_query_filter(
			    'evidence_subset_closure_label',
			    'evidence used in automatic assertion');
		    }

		    // Fetch the data and grab the info we want.
		    var resp = go.search();
		    var count = resp.total_documents();

		    // Accumulate the counts separately.
		    if( test_type === 'total' ){
			ann_bookmark =
			    'http://amigo.geneontology.org/amigo/search/annotation?' + go.get_filter_query_string();
			all_annotation_accumulator += count;
			local_all_accumulator += count;
		    }else if( test_type === 'exp' ){
			exp_annotation_accumulator += count;
			local_exp_accumulator += count;
		    }else if( test_type === 'iea' ){
			iea_annotation_accumulator += count;
			local_iea_accumulator += count;
		    }

		    // // Report.
		    // var report_string = 'Annotations ('+test_type+'): ' + count;
		    // _ll(report_string);
		    // //_ll(bookmark);
		});

		// Report.
		var export_ann_summary_items = [
		    local_all_accumulator,
		    local_exp_accumulator,
		    local_iea_accumulator
		];
		var ann_report_string = 'Annotation summary: total (' +
			local_all_accumulator + '), exp (' +
			local_exp_accumulator + '), iea (' +
			local_iea_accumulator + ')';
		rcache['ann-bookmark'] = ann_bookmark; // capture
		rcache['ann-summary-items'] =
		    export_ann_summary_items; // capture
		_ll(ann_report_string + '; ' + ann_bookmark);
	    }

	})();
    }

    // Add to collection.
    export_data.push(rcache);

    // Spacing for next "set".
    _ll('');

});

// Summary report.
// I removed the bad exits here because reporting and jenkins-style
// build success need to be different things.
// Maybe reconsider once the ontology is fixed.
_ll('Looked at ' + (us.keys(intersection_checks)).length + ' rules.');
_ll('Skipped ' + rules_skipped + ' rules when making annotation summary due to size.');
_ll('For remaining annotation summary, found ' + all_annotation_accumulator + ' total erring annotation(s);');
_ll('with ' + exp_annotation_accumulator + ' EXP annotation(s);');
_ll('and ' + iea_annotation_accumulator + ' IEA annotation(s).');

///
/// Publish table to page.
///

if( ! tmpl_output_p ){
    _ll('(No reference page output.)');
}else{
    _ll('(Create reference page...)');

    _debug('export_data', export_data);

    // Pug/Jade for table.
    var html_table_str = pug.renderFile('./templates/static-table.pug',
					{"export_data": export_data});
    _debug(html_table_str);

    // Mustache for final.
    var template = fs.readFileSync('./templates/page.tmpl', 'utf-8');
    _debug('template', template);

    // Binary variable for mustache.
    var rules_erred_p = null;
    if( error_intersection_accumulator > 0 ){
	rules_erred_p = true;
    }

    var outstr = mustache.render(template, {
	"jsondata": JSON.stringify(export_data),
	"htmltablestr": html_table_str,
	"data": export_data,
	"rules-number": (us.keys(intersection_checks)).length || '0',
	"rules-skipped": rules_skipped || '0',
	"rules-erred": error_intersection_accumulator || '0',
	"rules-erred-p": rules_erred_p,
	"ann-acc-all": all_annotation_accumulator || '0',
	"ann-acc-exp": exp_annotation_accumulator || '0',
	"ann-acc-iea": iea_annotation_accumulator || '0',
	"published-date": (new Date()).toISOString()
    });
    fs.writeFileSync(out_file, outstr);

    _ll('(...output reference page  to: ' + out_file + ')');
}

// Final closeout for Jenkins error code check.
if( error_intersection_accumulator > 0 ){
    //_die('Exiting with ' + error_intersection_accumulator + ' broken rule(s).');
    _ll('Exiting with ' + error_intersection_accumulator + ' broken rule(s).');
}else{
    _ll('Completed with no broken rules :)');
}
