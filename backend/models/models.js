const mongoose = require('mongoose')
	const Schema   = mongoose.Schema

	const TestSchema = new mongoose.Schema({

	  string: { 
	     type     : String, 
	     required : true,
	     unique   : true
	  },
	  number: {
	     type     : Number, 
	     required : true,
	     unique   : true
	  },
	  array: {
	     type     : Array,
	     required : true,
	     unique   : true
	  },
	  created : { 
	  	type: Date, 
	  	default: Date.now 
	  }
	});

	const Test = mongoose.model('Test', TestSchema)
	module.exports = Test