# Measured model state

The verified Qwen3.5-2B Q4_K_M baseline remains unchanged. Isolated Qwen3.5-4B and Phi-4-mini tests did not establish sufficient quality advantage to promote either model. All three produced actual Arabic text on Host; the hair question exposed length/repetition or comprehension defects. One 4B main-UI capability answer was grounded, but that single case is not broad acceptance.

Observed Linux peak VmHWM was about 1.83 GiB for 2B, 4.09 GiB for 4B and 4.11 GiB for Phi. These are process measurements, not Android PSS, battery or thermal results. Concurrent engineering activity makes exploratory latencies unsuitable as a controlled mobile ranking.

An isolated 207-token Arabic planner prompt reduced input and TTFT but all six paired constrained plans still chose clarification, with additional correction errors. It was not adopted. The final acceptance holdout has not been used for prompt/model selection. No aggregate intelligence score or Samsung benchmark is claimed.

Detailed inputs, failures, metrics, model hashes, licenses and correct templates are preserved in docs/v3.2/native-execution-evidence, native-phi-evidence and native-planner-concise-evidence.
