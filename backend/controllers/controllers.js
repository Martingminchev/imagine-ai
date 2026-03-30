//uncomment if you need to use the database
	 //const Test = require('../models/models.test')

	const getTest = async (req,res) => {
	    try{
	    	res.send({ok:true,message:'coming from getTest'})
	    }catch( error ){
	    	res.send({ok:false,message:error})
	    }
	}

	const postTest = async (req,res) => {
	    try{
	        res.send({ok:true,message:'coming from postTest'})
	    }catch( error ){
	    	res.send({ok:false,message:error})
	    }
	}

	module.exports = { 
		getTest,
		postTest
	}