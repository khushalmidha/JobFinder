import resumeData from '../resumes.json';

/**
 * Generates natural, authentic "humanoid" responses for application essay / text questions
 * tailored to Khushal's selected resume variant and target company/role.
 */
export function generateHumanoidAnswer(question = '', company = '', role = '', selectedResumeId = 'variant_sde_fullstack') {
  const q = question.toLowerCase();
  const c = company || 'your engineering team';
  const r = role || 'Software Engineer';
  const profile = resumeData.profile;
  const isQuant = selectedResumeId === 'variant_quant_cpp';
  const isML = selectedResumeId === 'variant_ml_ai';

  // 1. "Why this company / Why this role / Why join us?"
  if (q.includes('why') && (q.includes('company') || q.includes('join') || q.includes('work here') || q.includes('role') || q.includes('interested') || q.includes('apply'))) {
    if (isQuant) {
      return `What genuinely excites me about ${c} is the intersection of mathematical rigor and low-latency systems engineering. As a CS & AI student at IIIT Lucknow with deep passion for algorithmic problem solving (LeetCode Guardian 2137, Codeforces Expert 1809), I love solving problems where every microsecond matters. In my QuantDesk project, I developed a deterministic C++ order matching engine with price-time priority and Avellaneda-Stoikov market making. I want to bring that same intensity, disciplined analytical thinking, and high-performance C++ mindset to solve complex challenges alongside the brilliant team at ${c}.`;
    }
    if (isML) {
      return `I've been closely following how ${c} is leveraging cutting-edge intelligence to tackle real problems at scale. Having specialized in Computer Science & AI at IIIT Lucknow, my focus has been on high-throughput applied ML. For instance, in ThreatGraph I architected a spatial-temporal engine combining Graph Neural Networks and Transformers processing 3,000+ events/sec via Kafka, and in Jagrit I built real-time ranking using XGBoost and PyTorch. The opportunity to deploy robust, production-grade intelligence at ${c} for the ${r} role is an exact match for what I love building.`;
    }
    return `I'm particularly drawn to ${c} because of the high engineering bar and the scale at which your products operate. At IIIT Lucknow, I've channeled my enthusiasm into architecting reliable, high-concurrency systems—such as MediPulse, an end-to-end healthcare SaaS with 125 REST APIs where I solved race conditions using Redis distributed locks and asynchronous Kafka events. I pride myself on clean architecture, relentless problem-solving (solving 3,000+ DSA problems across Codeforces & LeetCode), and rapid execution. Contributing to ${c}'s mission as a ${r} would be an exhilarating next step in my journey.`;
  }

  // 2. "Challenging technical problem / Bug / Difficult project"
  if (q.includes('challenge') || q.includes('difficult') || q.includes('bug') || q.includes('problem you solved') || q.includes('complex')) {
    if (isQuant) {
      return `A standout challenge I tackled was eliminating race conditions and non-deterministic latencies in QuantDesk, a C++ limit order book matching engine. During high-volume order bursts, standard lock contention resulted in unpredictable queue processing. I refactored the matching core to use deterministic price-time priority structures with cache-friendly contiguous data buffers, verified through GoogleTest unit suites. This reduced execution jitter significantly and taught me the immense value of mechanical sympathy and cache-conscious data layout.`;
    }
    if (isML) {
      return `A major technical hurdle arose when engineering ThreatGraph, a spatial-temporal threat detection pipeline. We dealt with extreme class imbalance (less than 0.1% true malicious payloads) and heavy event bursts of 3,000+ events/sec. Standard classifiers suffered severe false positives. I fused Graph Neural Networks with temporal Transformers to capture relationship topologies rather than isolated features, streaming through Kafka and FAISS. By restructuring the loss function and feature store in Redis, we achieved a 92% PR-AUC on imbalanced attack vectors.`;
    }
    return `A challenging technical scenario I navigated occurred while engineering MediPulse, a multi-tenant healthcare SaaS. During mock peak registration periods, concurrent appointment bookings across live OPD queues triggered race conditions, occasionally leading to double-booked slots. To fix this permanently, I introduced Redis distributed locks with idempotent tokens and transactional rollbacks, backed by an asynchronous Kafka pipeline for wallet deductions. This guaranteed strict serialization and zero data inconsistencies under high concurrency.`;
  }

  // 3. "Tell us about yourself / Elevator pitch / Summary"
  if (q.includes('about yourself') || q.includes('summary') || q.includes('introduce') || q.includes('bio') || q.includes('background')) {
    return `I'm Khushal Midha, a B.Tech student in Computer Science & Artificial Intelligence at IIIT Lucknow (CGPA: 8.72/10) and an incoming software engineer passionate about scalable backend systems and intelligent architectures. I hold Guardian status on LeetCode (2137), Expert on Codeforces (1809), and was an ICPC Amritapuri Regionalist. During my SDE internship at Coffeee.io, I built project-based code evaluation modules in Spring Boot and Docker. Whether architecting microservices with Kafka & Redis or optimizing low-latency pipelines, I enjoy building software that is fast, resilient, and human-centric.`;
  }

  // 4. "Core technical strengths / Skills"
  if (q.includes('strength') || q.includes('skills') || q.includes('strongest') || q.includes('superpower')) {
    return `My core strength is the combination of deep algorithmic problem-solving and rapid full-stack execution. Having solved over 3,000 DSA problems and competed at the ICPC regional level, I can decompose ambiguous, complex logic swiftly. Complementing this is strong systems craftsmanship: designing RESTful microservices, caching with Redis, event-streaming with Kafka, and containerizing with Docker. I pick up unfamiliar frameworks in days and take extreme ownership from initial design to production delivery.`;
  }

  // 5. "Why should we hire you? / What makes you stand out?"
  if (q.includes('why should we hire') || q.includes('stand out') || q.includes('value') || q.includes('fit for this role')) {
    return `You should hire me because I combine academic foundation (8.72 CGPA at IIIT Lucknow), competitive discipline (LeetCode Guardian, Meta Hacker Cup Round 3 rank 186 among 14,000+ participants), and proven production experience. I don't just write code; I think about latency, failure recovery, idempotent transactions, and developer experience. I am proactive, deeply curious, and ready to contribute meaningful PRs from week one at ${c}.`;
  }

  // 6. "Notice period / Availability / Start date"
  if (q.includes('notice') || q.includes('availability') || q.includes('start date') || q.includes('when can you start')) {
    return `I am available to join immediately (0 days notice). For internships or full-time roles, I am flexible with start dates and open to both remote and in-office setups across India or globally.`;
  }

  // 7. "Salary expectations / Expected CTC"
  if (q.includes('salary') || q.includes('ctc') || q.includes('compensation') || q.includes('expectations')) {
    return `I am looking for a competitive package aligned with industry standards and ${c}'s standard compensation bands for freshers / SDE 1 (typically around ₹18 - ₹25 LPA CTC). However, learning velocity and engineering impact are my top priorities, and I am flexible for the right opportunity.`;
  }

  // 8. "Any other comments / Cover note"
  if (q.includes('anything else') || q.includes('additional') || q.includes('cover') || q.includes('note')) {
    return `Thank you for reviewing my application! I'm genuinely enthusiastic about the work being done at ${c} and would love the chance to demonstrate my problem-solving ability in an engineering interview. My code and open-source projects are available at github.com/khushalmidha.`;
  }

  // Fallback humanoid response
  return `As a Computer Science & AI student at IIIT Lucknow with extensive full-stack and distributed systems experience (MediPulse, ThreatGraph) and strong competitive coding discipline (LeetCode Guardian 2137), I bring both analytical rigor and practical system design experience. I am committed to writing clean, tested, and high-performance code that moves key metrics for ${c}.`;
}
