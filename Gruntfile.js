
'use strict';

module.exports = function(grunt) {

  require('load-grunt-tasks')(grunt);
  grunt.registerTask('default', [
    'jshint'
  ]);

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    githooks: {
      all: {
        'pre-commit': 'jsbeautifier:verify jshint'
      }
    },

    jsbeautifier: {
      options: {
        config: '.jsbeautifyrc'
      },

      default: {
        src: ['lib/**/*.js']
      },

      verify: {
        src: ['lib/**/*.js'],
        options: {
          mode: 'VERIFY_ONLY'
        }
      }
    },

    jshint: {
      options: {
        jshintrc: '.jshintrc'
      },

      gruntfile: {
        src: 'Gruntfile.js'
      },

      default: {
        src: ['Gruntfile.js', 'lib/**/*.js']
      }
    }

  });

};