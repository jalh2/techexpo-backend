const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Configure CORS to accept all origins, headers, and methods
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Anthropic API configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Common diseases in West Africa/Liberia for context
const COMMON_CONDITIONS = {
  infectious: [
    'Malaria', 'Typhoid fever', 'Dengue fever', 'Yellow fever',
    'Hepatitis A/B', 'Cholera', 'Meningitis', 'Tuberculosis',
    'Schistosomiasis', 'Onchocerciasis (River blindness)'
  ],
  respiratory: [
    'Upper respiratory tract infection', 'Pneumonia', 'Bronchitis',
    'Asthma', 'Allergic rhinitis'
  ],
  gastrointestinal: [
    'Gastroenteritis', 'Food poisoning', 'Peptic ulcer',
    'Irritable bowel syndrome', 'Parasitic infections'
  ],
  skin: [
    'Fungal skin infections', 'Bacterial skin infections',
    'Eczema', 'Scabies', 'Insect bites'
  ]
};

// Severity classification keywords
const SEVERITY_INDICATORS = {
  emergency: [
    'difficulty breathing', 'chest pain', 'severe bleeding',
    'loss of consciousness', 'severe dehydration', 'high fever above 39°C',
    'persistent vomiting', 'severe abdominal pain', 'confusion'
  ],
  urgent: [
    'persistent fever', 'severe headache', 'persistent diarrhea',
    'significant weight loss', 'persistent cough', 'severe fatigue'
  ],
  mild: [
    'mild headache', 'minor rash', 'mild nausea', 'minor aches',
    'mild cough', 'slight fever'
  ]
};

// Function to build Anthropic prompt
function buildDiagnosisPrompt(symptoms) {
  const { gender, physicalSymptoms, internalSymptoms } = symptoms;
  
  return `You are a medical AI assistant helping with symptom assessment in Liberia, West Africa. 
  
IMPORTANT: Always emphasize that this is not a substitute for professional medical care.

Patient Information:
- Gender: ${gender}
- Physical symptoms: ${physicalSymptoms}
- Internal symptoms: ${internalSymptoms}

Context: This patient is in Liberia, West Africa. Consider common regional health conditions including:
- Malaria (very common)
- Typhoid fever
- Dengue fever
- Gastrointestinal infections
- Respiratory infections
- Skin conditions due to climate

Please provide:
1. Most likely condition(s) based on symptoms
2. Severity assessment (Emergency/Urgent/Mild)
3. Immediate care recommendations
4. When to seek professional medical help
5. Preventive measures
6. Additional questions that might help narrow diagnosis

Format your response as JSON with the following structure:
{
  "primaryDiagnosis": "Most likely condition",
  "alternativeDiagnoses": ["Alternative 1", "Alternative 2"],
  "severity": "Emergency|Urgent|Mild",
  "urgencyLevel": "Seek immediate medical attention|Consult healthcare provider within 24-48 hours|Monitor symptoms and seek care if worsening",
  "treatmentRecommendations": ["Recommendation 1", "Recommendation 2"],
  "warningSignsToWatch": ["Warning sign 1", "Warning sign 2"],
  "additionalQuestions": ["Question 1", "Question 2"],
  "preventiveMeasures": ["Prevention 1", "Prevention 2"],
  "disclaimer": "This assessment is for informational purposes only. Always consult healthcare professionals for proper diagnosis and treatment."
}

Important: If symptoms suggest a potentially serious condition, always recommend immediate medical attention.`;
}

// Function to assess severity based on keywords
function assessSeverityFromSymptoms(physicalSymptoms, internalSymptoms) {
  const allSymptoms = `${physicalSymptoms} ${internalSymptoms}`.toLowerCase();
  
  const emergencyFound = SEVERITY_INDICATORS.emergency.some(indicator => 
    allSymptoms.includes(indicator.toLowerCase())
  );
  
  const urgentFound = SEVERITY_INDICATORS.urgent.some(indicator => 
    allSymptoms.includes(indicator.toLowerCase())
  );
  
  if (emergencyFound) return 'Emergency';
  if (urgentFound) return 'Urgent';
  return 'Mild';
}

// Main diagnosis endpoint
app.post('/api/diagnose', async (req, res) => {
  try {
    const { gender, physicalSymptoms, internalSymptoms } = req.body;
    
    // Validate input
    if (!gender || !physicalSymptoms || !internalSymptoms) {
      return res.status(400).json({
        error: 'Missing required fields: gender, physicalSymptoms, internalSymptoms'
      });
    }

    // Build prompt for Anthropic
    const prompt = buildDiagnosisPrompt(req.body);
    
    // Call Anthropic API
    const anthropicResponse = await axios.post(
      ANTHROPIC_API_URL,
      {
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    console.log('Anthropic API response:', anthropicResponse.data);

    // Parse the response
    let diagnosis;
    try {
      const responseContent = anthropicResponse.data.content[0].text;
      // Extract JSON from response if it's wrapped in other text
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        diagnosis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in response');
      }
    } catch (parseError) {
      console.error('Error parsing Anthropic response:', parseError);
      // Fallback response
      diagnosis = {
        primaryDiagnosis: "Unable to determine specific condition",
        severity: assessSeverityFromSymptoms(physicalSymptoms, internalSymptoms),
        urgencyLevel: "Consult healthcare provider for proper diagnosis",
        treatmentRecommendations: ["Seek professional medical evaluation"],
        disclaimer: "This assessment is for informational purposes only. Always consult healthcare professionals for proper diagnosis and treatment."
      };
    }

    // Add timestamp and session info
    const response = {
      ...diagnosis,
      timestamp: new Date().toISOString(),
      patientData: {
        gender,
        physicalSymptoms,
        internalSymptoms
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in diagnosis endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Unable to process diagnosis request'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Medical Diagnosis API'
  });
});

// Get common conditions endpoint (for reference)
app.get('/api/conditions', (req, res) => {
  res.json({
    commonConditions: COMMON_CONDITIONS,
    message: 'Common health conditions in Liberia/West Africa'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(error.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: error.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Medical Diagnosis API server running on port ${PORT}`);
  console.log(`Health check available at: http://localhost:${PORT}/api/health`);
});

module.exports = app;